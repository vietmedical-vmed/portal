// ════════════════════════════════════════════════════════════════════════
// admin-users — quản lý tài khoản shared.users cho portal (chỉ admin).
//
//   POST /functions/v1/admin-users
//   headers: apikey, Authorization: Bearer <anon>, x-portal-token: <vmed_token>
//   body   : { action, ... }
//
//   options        → roles, profiles (roles.ts), dm_mien, dm_bu, dm_nhom_san_pham, dm_ps
//   list           → { q, role, mien, bu, active, page, page_size }
//   check_username → { username }
//   create         → { user, password }
//   update         → { username, user }
//   reset_password → { username, password }
//   set_active     → { username, active }
//
// Mật khẩu: ghi theo scheme chung của cả 5 app — password_hash = sha256(salt + ":" + pw).
// password_bcrypt / password_hash_v2 xoá về null để từng app tự sinh lại (lazy) khi login.
//
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TOKEN_SECRET (dùng chung với sale_target-login).
// Deploy : supabase functions deploy admin-users --no-verify-jwt --project-ref nrfxymnfmjhbsgpipvkb
// ════════════════════════════════════════════════════════════════════════
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, getAllowedOrigin, json as _json } from "../_shared/cors.ts";
import { sha256Hex, verifyToken } from "../_shared/auth.ts";
import { GENERIC_PROFILE, profileOf, ROLE_PROFILES } from "./roles.ts";

const USERNAME_RE = /^[a-z0-9._]{3,32}$/;
const ROLE_RE = /^[a-z_]{2,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 6;
const PAGE_SIZE_MAX = 100;
const USER_COLS =
  "username, ho_va_ten, email, role, bu, mien, scope, nhom_san_pham, active, created_at, created_by, updated_at, updated_by";

class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) { super(message ?? code); }
}

Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) => _json(body, status, req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(getAllowedOrigin(req)) });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);

  const secret = Deno.env.get("TOKEN_SECRET");
  if (!secret) return json({ ok: false, error: "config_error" }, 500);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ ok: false, error: "bad_body" }, 400); }

  const db = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  try {
    const actor = await requireAdmin(db, req.headers.get("x-portal-token") ?? "", secret);
    const action = String(body.action || "");
    switch (action) {
      case "options":        return json({ ok: true, ...(await loadOptions(db)) });
      case "list":           return json({ ok: true, ...(await listUsers(db, body)) });
      case "check_username": return json({ ok: true, taken: !!(await findUser(db, normUsername(body.username))) });
      case "create":         return json({ ok: true, user: await createUser(db, actor, body) });
      case "update":         return json({ ok: true, user: await updateUser(db, actor, body) });
      case "reset_password": await resetPassword(db, actor, body); return json({ ok: true });
      case "set_active":     return json({ ok: true, user: await setActive(db, actor, body) });
      default:               return json({ ok: false, error: "unknown_action" }, 400);
    }
  } catch (e) {
    if (e instanceof HttpError) return json({ ok: false, error: e.code, message: e.message }, e.status);
    console.error(e);
    return json({ ok: false, error: "server_error", message: String((e as Error)?.message || e) }, 500);
  }
});

// ---------- Auth ----------
// Không tin role trong token (sống 2h): đọc lại DB để chắc người gọi vẫn là admin & đang active.
async function requireAdmin(db: SupabaseClient, token: string, secret: string): Promise<string> {
  const sess = await verifyToken(token, secret);
  if (!sess || !sess.u) throw new HttpError(401, "token_expired");
  const { data, error } = await users(db).select("username, role, active").eq("username", sess.u).maybeSingle();
  if (error) throw error;
  if (!data || data.active === false || String(data.role || "").toLowerCase() !== "admin") {
    throw new HttpError(403, "forbidden");
  }
  return data.username as string;
}

const users = (db: SupabaseClient) => db.schema("shared").from("users");

// ---------- Danh mục ----------
interface Dicts {
  mien: { ma_mien: string; ten_mien: string }[];
  mienAlias: Map<string, string>;
  bu: { bu_code: string; ten_bu: string; is_test: boolean }[];
  nhom: { nhom_san_pham: string; bu_code: string }[];
  ps: { ps: string; ten_ps: string; bu_code: string; area: string; mien_code: string; active: boolean }[];
}

const normKey = (s: unknown) => String(s ?? "").normalize("NFC").toLowerCase().replace(/\s+/g, "");

async function loadDicts(db: SupabaseClient): Promise<Dicts> {
  const sh = db.schema("shared");
  const [mien, alias, bu, nhom, ps] = await Promise.all([
    sh.from("dm_mien").select("ma_mien, ten_mien, thu_tu").order("thu_tu"),
    sh.from("dm_mien_alias").select("alias_norm, ma_mien"),
    sh.from("dm_bu").select("bu_code, ten_bu, thu_tu, is_test, active").eq("active", true).order("thu_tu"),
    sh.from("dm_nhom_san_pham").select("nhom_san_pham, bu_code").order("nhom_san_pham"),
    sh.from("dm_ps").select("ps, ten_ps, bu_code, area, trang_thai").order("ps").limit(2000),
  ]);
  for (const r of [mien, alias, bu, nhom, ps]) if (r.error) throw r.error;

  const mienAlias = new Map<string, string>();
  for (const a of alias.data ?? []) mienAlias.set(normKey(a.alias_norm), a.ma_mien);
  for (const m of mien.data ?? []) {
    mienAlias.set(normKey(m.ma_mien), m.ma_mien);
    mienAlias.set(normKey(m.ten_mien), m.ma_mien);
  }
  return {
    mien: (mien.data ?? []).map((m) => ({ ma_mien: m.ma_mien, ten_mien: m.ten_mien })),
    mienAlias,
    bu: (bu.data ?? []).map((b) => ({ bu_code: b.bu_code, ten_bu: b.ten_bu, is_test: !!b.is_test })),
    nhom: (nhom.data ?? []).map((n) => ({ nhom_san_pham: n.nhom_san_pham, bu_code: n.bu_code })),
    ps: (ps.data ?? []).filter((p) => p.ps).map((p) => ({
      ps: p.ps, ten_ps: p.ten_ps ?? "", bu_code: p.bu_code ?? "", area: p.area ?? "",
      mien_code: mienAlias.get(normKey(p.area)) ?? "",
      active: String(p.trang_thai || "").toLowerCase() !== "inactive",
    })),
  };
}

async function loadOptions(db: SupabaseClient) {
  const [dicts, roleRows] = await Promise.all([loadDicts(db), users(db).select("role").limit(5000)]);
  if (roleRows.error) throw roleRows.error;
  const roles = [...new Set([
    ...Object.keys(ROLE_PROFILES),
    ...(roleRows.data ?? []).map((r) => String(r.role || "").toLowerCase()).filter(Boolean),
  ])].sort();
  const { mienAlias: _skip, ...rest } = dicts;
  return { roles, profiles: ROLE_PROFILES, generic_profile: GENERIC_PROFILE, ...rest };
}

// ---------- Chuẩn hoá & validate theo role ----------
const splitList = (v: unknown): string[] =>
  (Array.isArray(v) ? v : String(v ?? "").split(","))
    .map((x) => String(x ?? "").trim()).filter(Boolean);
const uniq = <T>(a: T[]) => [...new Set(a)];
const bad = (code: string, message: string) => new HttpError(400, code, message);

function normUsername(v: unknown) { return String(v ?? "").trim().toLowerCase(); }

interface UserRow {
  ho_va_ten: string; email: string | null; role: string;
  bu: string; mien: string; scope: string | null; nhom_san_pham: string | null;
}

function normalizeUser(input: Record<string, unknown>, d: Dicts): UserRow {
  const ho_va_ten = String(input.ho_va_ten ?? "").trim();
  if (!ho_va_ten) throw bad("invalid_ho_va_ten", "Họ và tên không được trống");

  const emailRaw = String(input.email ?? "").trim();
  if (emailRaw && !EMAIL_RE.test(emailRaw)) throw bad("invalid_email", "Email không hợp lệ");

  const role = String(input.role ?? "").trim().toLowerCase();
  if (!ROLE_RE.test(role)) throw bad("invalid_role", "Role không hợp lệ");
  const p = profileOf(role);

  const buCodes = new Set(d.bu.map((b) => b.bu_code));
  const mienByCode = new Map(d.mien.map((m) => [m.ma_mien, m.ten_mien]));

  // PS: bu + mien lấy theo danh mục PS
  let psRow: Dicts["ps"][number] | undefined;
  if (p.scope === "ps") {
    const ps = String(input.scope ?? "").trim();
    if (!ps) throw bad("invalid_scope", "Chưa chọn PS");
    psRow = d.ps.find((x) => normKey(x.ps) === normKey(ps));
    if (!psRow) throw bad("invalid_scope", `PS "${ps}" không có trong dm_ps`);
  }

  // BU
  let buList: string[]; // rỗng = 'all'
  if (p.bu === "all") buList = [];
  else if (p.bu === "auto") {
    if (!psRow?.bu_code) throw bad("invalid_bu", `PS "${psRow?.ps}" chưa có bu_code trong dm_ps`);
    buList = [psRow.bu_code];
  } else {
    const raw = splitList(input.bu).map((x) => x.toLowerCase());
    buList = raw.includes("all") ? [] : uniq(raw);
    const unknown = buList.filter((c) => !buCodes.has(c));
    if (unknown.length) throw bad("invalid_bu", `BU không hợp lệ: ${unknown.join(", ")}`);
    if (p.bu === "single" && buList.length !== 1) throw bad("invalid_bu", "Role này cần chọn đúng 1 BU");
  }
  const bu = buList.length ? buList.join(", ") : "all";

  // Miền
  let mien: string;
  if (p.mien === "both") mien = "BOTH";
  else if (p.mien === "auto") {
    if (!psRow?.mien_code) throw bad("invalid_mien", `Không xác định được miền của PS "${psRow?.ps}" (area: ${psRow?.area || "trống"})`);
    mien = psRow.mien_code;
  } else {
    const raw = String(input.mien ?? "").trim().toUpperCase();
    if (p.mien === "any" && (raw === "" || raw === "BOTH" || raw === "ALL")) mien = "BOTH";
    else if (mienByCode.has(raw)) mien = raw;
    else throw bad("invalid_mien", p.mien === "single" ? "Role này cần chọn 1 miền" : "Miền không hợp lệ");
  }

  // Nhóm SP hợp lệ theo BU đã chọn
  const nhomAllowed = new Set(
    d.nhom.filter((n) => !buList.length || buList.includes(n.bu_code)).map((n) => n.nhom_san_pham),
  );
  const pickNhom = (v: unknown, field: string) => {
    const list = uniq(splitList(v));
    const unknown = list.filter((x) => !nhomAllowed.has(x));
    if (unknown.length) throw bad(`invalid_${field}`, `Nhóm SP không thuộc BU đã chọn: ${unknown.join(", ")}`);
    return list;
  };

  // Scope
  let scope: string | null = null;
  switch (p.scope) {
    case "none": scope = null; break;
    case "nhom_sp": scope = pickNhom(input.scope, "scope").join(", ") || null; break;
    case "ten_mien": scope = mienByCode.get(mien) ?? null; break;
    case "ps": scope = psRow!.ps; break;
    case "free": scope = String(input.scope ?? "").trim() || null; break;
  }
  if (p.scopeRequired && !scope) throw bad("invalid_scope", "Role này bắt buộc nhập scope");

  const nhom_san_pham = p.nhom === "hidden" ? null : (pickNhom(input.nhom_san_pham, "nhom_san_pham").join(", ") || null);

  return { ho_va_ten, email: emailRaw || null, role, bu, mien, scope, nhom_san_pham };
}

// ---------- Mật khẩu ----------
function checkPassword(pw: unknown): string {
  const s = String(pw ?? "");
  if (s.length < MIN_PASSWORD) throw bad("weak_password", `Mật khẩu tối thiểu ${MIN_PASSWORD} ký tự`);
  return s;
}

async function passwordColumns(pw: string) {
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  return {
    salt,
    password_hash: await sha256Hex(salt + ":" + pw),
    password_bcrypt: null,
    password_hash_v2: null,
  };
}

// ---------- Actions ----------
// ilike không phân biệt hoa/thường; escape wildcard vì username được phép chứa "_".
async function findUser(db: SupabaseClient, username: string) {
  if (!username) return null;
  const pattern = username.replace(/[\\%_]/g, (c) => "\\" + c);
  const { data, error } = await users(db).select(USER_COLS).ilike("username", pattern).limit(1);
  if (error) throw error;
  return data?.[0] ?? null;
}

async function mustFind(db: SupabaseClient, username: unknown) {
  const u = await findUser(db, normUsername(username));
  if (!u) throw new HttpError(404, "not_found", "Không tìm thấy tài khoản");
  return u;
}

async function listUsers(db: SupabaseClient, b: Record<string, unknown>) {
  const pageSize = Math.min(Math.max(Number(b.page_size) || 20, 1), PAGE_SIZE_MAX);
  const page = Math.max(Number(b.page) || 1, 1);
  let q = users(db).select(USER_COLS, { count: "exact" });

  const term = String(b.q ?? "").replace(/[,()*\\%]/g, " ").trim();
  if (term) q = q.or(`username.ilike.*${term}*,ho_va_ten.ilike.*${term}*,email.ilike.*${term}*`);
  if (b.role) q = q.eq("role", String(b.role).toLowerCase());
  if (b.mien) q = q.eq("mien", String(b.mien));
  if (b.bu) q = q.ilike("bu", `%${String(b.bu).replace(/[\\%_*]/g, "")}%`);
  if (b.active === true || b.active === false) q = q.eq("active", b.active);

  const from = (page - 1) * pageSize;
  const { data, count, error } = await q.order("username").range(from, from + pageSize - 1);
  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0, page, page_size: pageSize };
}

function mapDbError(e: { code?: string; message?: string }): never {
  if (e.code === "23505") throw new HttpError(409, "username_taken", "Tài khoản đã tồn tại");
  if (e.code === "23503") throw bad("invalid_ref", e.message || "Mã danh mục không hợp lệ");
  if (e.code === "23514") throw bad("invalid_check", e.message || "Dữ liệu vi phạm ràng buộc");
  throw e;
}

async function createUser(db: SupabaseClient, actor: string, b: Record<string, unknown>) {
  const input = (b.user ?? {}) as Record<string, unknown>;
  const username = normUsername(input.username);
  if (!USERNAME_RE.test(username)) {
    throw bad("invalid_username", "Tài khoản 3–32 ký tự, chỉ gồm a-z, 0-9, dấu chấm, gạch dưới");
  }
  if (await findUser(db, username)) throw new HttpError(409, "username_taken", "Tài khoản đã tồn tại");

  const row = normalizeUser(input, await loadDicts(db));
  const pw = await passwordColumns(checkPassword(b.password));
  const now = new Date().toISOString();
  const { data, error } = await users(db)
    .insert({ username, ...row, ...pw, active: true, created_at: now, created_by: actor, updated_at: now, updated_by: actor })
    .select(USER_COLS).single();
  if (error) mapDbError(error);
  return data;
}

async function updateUser(db: SupabaseClient, actor: string, b: Record<string, unknown>) {
  const current = await mustFind(db, b.username);
  const row = normalizeUser((b.user ?? {}) as Record<string, unknown>, await loadDicts(db));

  if (current.username === actor && row.role !== "admin") {
    throw bad("self_demote", "Không thể tự hạ quyền admin của chính mình");
  }
  if (current.role === "admin" && row.role !== "admin" && current.active !== false) await assertOtherAdmin(db, current.username);

  const { data, error } = await users(db)
    .update({ ...row, updated_at: new Date().toISOString(), updated_by: actor })
    .eq("username", current.username).select(USER_COLS).single();
  if (error) mapDbError(error);
  return data;
}

async function resetPassword(db: SupabaseClient, actor: string, b: Record<string, unknown>) {
  const current = await mustFind(db, b.username);
  const pw = await passwordColumns(checkPassword(b.password));
  const { error } = await users(db)
    .update({ ...pw, updated_at: new Date().toISOString(), updated_by: actor })
    .eq("username", current.username);
  if (error) mapDbError(error);
}

async function setActive(db: SupabaseClient, actor: string, b: Record<string, unknown>) {
  const current = await mustFind(db, b.username);
  const active = b.active === true;
  if (!active && current.username === actor) throw bad("self_lock", "Không thể tự khoá tài khoản của chính mình");
  if (!active && current.role === "admin") await assertOtherAdmin(db, current.username);

  const { data, error } = await users(db)
    .update({ active, updated_at: new Date().toISOString(), updated_by: actor })
    .eq("username", current.username).select(USER_COLS).single();
  if (error) mapDbError(error);
  return data;
}

// Luôn phải còn ít nhất 1 admin đang active ngoài tài khoản sắp bị khoá/hạ quyền.
async function assertOtherAdmin(db: SupabaseClient, except: string) {
  const { count, error } = await users(db).select("username", { count: "exact", head: true })
    .eq("role", "admin").neq("active", false).neq("username", except);
  if (error) throw error;
  if (!count) throw bad("last_admin", "Phải còn ít nhất 1 admin đang hoạt động");
}

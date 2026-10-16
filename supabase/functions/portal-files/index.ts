// ════════════════════════════════════════════════════════════════════════
// portal-files — file nhúng làm tab trên portal (Excel / PowerPoint / PDF / ảnh).
//
//   POST /functions/v1/portal-files
//   headers: apikey, Authorization: Bearer <anon>, x-portal-token: <vmed_token>
//   body   : { action, ... }
//
//   upload_url → { name, size }  (admin) → { path, signed_url, content_type, kind }
//                trình duyệt PUT file lên signed_url (sống 2h, không ghi đè).
//   sign       → { path } | { paths } (user đã login) → { url } | { urls } signed URL 2h.
//                Chỉ ký file đang gắn với mục menu trong portal_config (item.file hoặc item.files)
//                và role được xem; admin ký được mọi file (xem trước khi lưu).
//   delete     → { path } | { paths } (admin) — gọi khi xoá / thay file của mục menu.
//
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TOKEN_SECRET (dùng chung với sale_target-login).
// Deploy : supabase functions deploy portal-files --no-verify-jwt --project-ref nrfxymnfmjhbsgpipvkb
// ════════════════════════════════════════════════════════════════════════
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, getAllowedOrigin, json as _json } from "../_shared/cors.ts";
import { verifyToken } from "../_shared/auth.ts";

const BUCKET = "portal-files";
const SIGN_TTL = 2 * 60 * 60;
const MAX_PATHS = 30;
const MB = 1024 * 1024;
const PATH_RE = /^files\/[0-9a-f-]{36}\.[a-z]{3,4}$/;
// Giống index.html: alias role cũ → role chuẩn.
const ROLE_ALIASES: Record<string, string> = { pm: "product_manager", sale_manager: "area_manager", am: "area_manager" };

// Giới hạn theo Office Online viewer: Excel ≤ 5 MB, Word/PowerPoint ≤ 10 MB.
const TYPES: Record<string, { kind: "excel" | "pptx" | "pdf" | "image"; mime: string; max: number }> = {
  pdf:  { kind: "pdf",   mime: "application/pdf", max: 10 * MB },
  xlsx: { kind: "excel", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", max: 5 * MB },
  xlsm: { kind: "excel", mime: "application/vnd.ms-excel.sheet.macroEnabled.12", max: 5 * MB },
  xls:  { kind: "excel", mime: "application/vnd.ms-excel", max: 5 * MB },
  pptx: { kind: "pptx",  mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", max: 10 * MB },
  ppt:  { kind: "pptx",  mime: "application/vnd.ms-powerpoint", max: 10 * MB },
  png:  { kind: "image", mime: "image/png", max: 10 * MB },
  jpg:  { kind: "image", mime: "image/jpeg", max: 10 * MB },
  jpeg: { kind: "image", mime: "image/jpeg", max: 10 * MB },
  gif:  { kind: "image", mime: "image/gif", max: 10 * MB },
  webp: { kind: "image", mime: "image/webp", max: 10 * MB },
};

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
    const me = await requireUser(db, req.headers.get("x-portal-token") ?? "", secret);
    const action = String(body.action || "");
    switch (action) {
      case "upload_url": requireAdmin(me); return json({ ok: true, ...(await uploadUrl(db, body)) });
      case "sign":       return json({ ok: true, ...(await sign(db, me, body)) });
      case "delete":     requireAdmin(me); await remove(db, body); return json({ ok: true });
      default:           return json({ ok: false, error: "unknown_action" }, 400);
    }
  } catch (e) {
    if (e instanceof HttpError) return json({ ok: false, error: e.code, message: e.message }, e.status);
    console.error(e);
    return json({ ok: false, error: "server_error", message: String((e as Error)?.message || e) }, 500);
  }
});

// ---------- Auth ----------
// Không tin role trong token (sống 2h): đọc lại DB để chắc người gọi còn active và đúng role.
interface Me { username: string; role: string }

async function requireUser(db: SupabaseClient, token: string, secret: string): Promise<Me> {
  const sess = await verifyToken(token, secret);
  if (!sess || !sess.u) throw new HttpError(401, "token_expired");
  const { data, error } = await db.schema("shared").from("users")
    .select("username, role, active").eq("username", sess.u).maybeSingle();
  if (error) throw error;
  if (!data || data.active === false) throw new HttpError(403, "forbidden", "Tài khoản không tồn tại hoặc đã bị khoá");
  return { username: data.username as string, role: normRole(data.role) };
}

function requireAdmin(me: Me) {
  if (me.role !== "admin") throw new HttpError(403, "forbidden", "Chỉ admin được thao tác file");
}

function normRole(r: unknown) {
  const lo = String(r ?? "").trim().toLowerCase();
  return ROLE_ALIASES[lo] ?? lo;
}

function checkPath(p: unknown): string {
  const path = String(p ?? "");
  if (!PATH_RE.test(path)) throw new HttpError(400, "bad_path", "Đường dẫn file không hợp lệ");
  return path;
}

// { path } → [path]; { paths } → danh sách (mục nhiều ảnh), tối đa MAX_PATHS.
function readPaths(b: Record<string, unknown>): string[] {
  const raw = Array.isArray(b.paths) ? b.paths : [b.path];
  if (!raw.length || raw.length > MAX_PATHS) throw new HttpError(400, "bad_path", `Cần 1–${MAX_PATHS} file`);
  return [...new Set(raw.map(checkPath))];
}

// Mục menu gắn 1 file (item.file) hoặc nhiều ảnh (item.files).
function itemPaths(it: Record<string, unknown>): string[] {
  const list = Array.isArray(it.files) ? it.files : it.file ? [it.file] : [];
  return list.map((f) => String((f as Record<string, unknown>)?.path ?? ""));
}

// ---------- Actions ----------
async function uploadUrl(db: SupabaseClient, b: Record<string, unknown>) {
  const name = String(b.name ?? "").trim();
  const ext = (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
  const t = TYPES[ext];
  if (!t) throw new HttpError(400, "bad_type", "Chỉ hỗ trợ Excel (.xlsx, .xlsm, .xls), PowerPoint (.pptx, .ppt), PDF và ảnh (.png, .jpg, .gif, .webp)");
  const size = Number(b.size);
  if (!Number.isFinite(size) || size <= 0) throw new HttpError(400, "bad_size", "File rỗng");
  if (size > t.max) throw new HttpError(400, "too_large", `File vượt giới hạn ${t.max / MB} MB cho loại .${ext}`);

  const path = `files/${crypto.randomUUID()}.${ext}`;
  const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error) throw error;
  return { path, signed_url: data.signedUrl, content_type: t.mime, kind: t.kind };
}

async function sign(db: SupabaseClient, me: Me, b: Record<string, unknown>) {
  const paths = readPaths(b);
  if (me.role !== "admin") {
    const { data, error } = await db.from("portal_config").select("items").eq("id", 1).maybeSingle();
    if (error) throw error;
    const items = Array.isArray(data?.items) ? data.items as Record<string, unknown>[] : [];
    const visible = new Set(items.filter((it) => {
      const roles = Array.isArray(it.roles) ? it.roles.map(normRole) : [];
      return roles.length === 0 || roles.includes(me.role);
    }).flatMap(itemPaths));
    if (!paths.every((p) => visible.has(p))) throw new HttpError(403, "forbidden", "Bạn không có quyền xem file này");
  }
  const { data, error } = await db.storage.from(BUCKET).createSignedUrls(paths, SIGN_TTL);
  if (error || !data || data.some((d) => d.error || !d.signedUrl)) throw new HttpError(404, "not_found", "Không tìm thấy file");
  const urls = paths.map((p) => data.find((d) => d.path === p)!.signedUrl);
  return Array.isArray(b.paths) ? { urls } : { url: urls[0] };
}

async function remove(db: SupabaseClient, b: Record<string, unknown>) {
  const { error } = await db.storage.from(BUCKET).remove(readPaths(b));
  if (error) throw error;
}

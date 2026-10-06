const enc = new TextEncoder();

export function b64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function hmac(secret: string, msg: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}

export async function signToken(payload: Record<string, unknown>, secret: string) {
  const p = b64url(enc.encode(JSON.stringify(payload)));
  const sig = b64url(await hmac(secret, p));
  return `${p}.${sig}`;
}

export interface Session {
  u: string;
  n: string;
  r: string;
  s: string;
  b: string;
  m: string;
  g: string;
  exp: number;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

export async function verifyToken(token: string, secret: string): Promise<Session | null> {
  if (!token || token.indexOf(".") < 0) return null;
  const [p, sig] = token.split(".");
  const expect = b64url(await hmac(secret, p));
  if (!timingSafeEqual(sig, expect)) return null;
  let payload: Record<string, unknown>;
  try {
    const bin = atob(p.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    const jsonStr = new TextDecoder("utf-8").decode(bytes);
    payload = JSON.parse(jsonStr);
  } catch { return null; }
  if (!payload.exp || Math.floor(Date.now() / 1000) > (payload.exp as number)) return null;
  return {
    u: (payload.username ?? payload.u) as string,
    n: (payload.ho_ten ?? payload.n ?? payload.username ?? payload.u) as string,
    r: (payload.role ?? payload.r) as string,
    s: (payload.scope ?? payload.s) as string,
    b: (payload.bu ?? payload.b) as string,
    m: (payload.mien ?? payload.m ?? "") as string,
    g: (payload.nhom_san_pham ?? payload.g ?? "") as string,
    exp: payload.exp as number,
  };
}

export async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

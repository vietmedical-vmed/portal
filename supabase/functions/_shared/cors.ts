// Bản riêng cho portal: thêm header x-portal-token (token dùng chung của portal).
const ALLOWED_ORIGINS = [
  "https://vietmedical-vmed.github.io",
  "http://localhost:5173",
  "http://localhost:4173",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
];

export function getAllowedOrigin(req: Request): string {
  const origin = req.headers.get("origin") ?? "";
  return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
}

export function corsHeaders(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-portal-token",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

export function json(body: unknown, status = 200, req?: Request) {
  const origin = req ? getAllowedOrigin(req) : ALLOWED_ORIGINS[0];
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

// Cấu hình field theo role — NGUỒN DUY NHẤT cho cả UI (trả qua action `options`) và validate server.
// Thêm/sửa role: chỉ sửa file này.
//
//   bu   : "all"    → luôn 'all' (khoá)
//          "multi"  → chọn nhiều bu_code hoặc 'all'
//          "single" → đúng 1 bu_code (sale-target chưa hỗ trợ nhiều BU cho role này)
//          "auto"   → lấy theo PS (dm_ps.bu_code)
//   mien : "both"   → luôn 'BOTH' (khoá)
//          "single" → đúng 1 ma_mien
//          "any"    → 'BOTH' hoặc 1 ma_mien
//          "auto"   → lấy theo PS (dm_ps.area → ma_mien)
//   scope: "none"     → để trống
//          "nhom_sp"  → danh sách nhóm SP (dm_nhom_san_pham), lọc theo BU
//          "ten_mien" → tự điền = dm_mien.ten_mien của miền đã chọn
//          "ps"       → mã PS (dm_ps.ps)
//          "free"     → nhập tự do
//   nhom : "hidden" | "optional" — cột nhom_san_pham (thu hẹp thêm, lọc giao)

export type BuMode = "all" | "multi" | "single" | "auto";
export type MienMode = "both" | "single" | "any" | "auto";
export type ScopeMode = "none" | "nhom_sp" | "ten_mien" | "ps" | "free";

export interface RoleProfile {
  label: string;
  bu: BuMode;
  mien: MienMode;
  scope: ScopeMode;
  scopeRequired: boolean;
  nhom: "hidden" | "optional";
}

export const ROLE_PROFILES: Record<string, RoleProfile> = {
  admin:           { label: "Admin",           bu: "all",    mien: "both",   scope: "none",     scopeRequired: false, nhom: "hidden" },
  manager:         { label: "Manager",         bu: "all",    mien: "both",   scope: "none",     scopeRequired: false, nhom: "hidden" },
  product_manager: { label: "Product Manager", bu: "multi",  mien: "both",   scope: "nhom_sp",  scopeRequired: true,  nhom: "hidden" },
  area_manager:    { label: "Area Manager",    bu: "single", mien: "single", scope: "ten_mien", scopeRequired: true,  nhom: "optional" },
  ps:              { label: "PS",              bu: "auto",   mien: "auto",   scope: "ps",       scopeRequired: true,  nhom: "optional" },
  purchasing:      { label: "Purchasing",      bu: "multi",  mien: "both",   scope: "nhom_sp",  scopeRequired: false, nhom: "optional" },
};

// Role chưa khai báo ở trên: form đầy đủ, scope nhập tự do.
export const GENERIC_PROFILE: RoleProfile = {
  label: "", bu: "multi", mien: "any", scope: "free", scopeRequired: false, nhom: "optional",
};

export function profileOf(role: string): RoleProfile {
  return ROLE_PROFILES[role] ?? GENERIC_PROFILE;
}

# Khối Ngoại Khoa Portal

Portal nội bộ tập trung các ứng dụng web và dashboard Power BI cho Khối Ngoại Khoa — Vietmedical.

## Tính năng

- **Đăng nhập tập trung** — xác thực một lần, token dùng chung cho các app con.
- **Menu điều hướng** — sidebar phân nhóm (Web Apps, Dashboard, …), hỗ trợ phân quyền theo role.
- **Nhúng iframe** — mở app/dashboard ngay trong trang; nếu không nhúng được thì mở tab mới.
- **Cấu hình Portal (Admin)** — thêm / sửa / xoá / kéo-thả sắp xếp các mục menu, xuất/nhập JSON.
- **Đổi mật khẩu** — người dùng tự đổi mật khẩu ngay trên portal.
- **Responsive** — giao diện sidebar thu gọn, hoạt động trên nhiều kích thước màn hình.

## Công nghệ

| Thành phần | Chi tiết |
|---|---|
| Frontend | Single-page HTML + vanilla JS (không framework) |
| Backend / Auth | Supabase Edge Functions |
| Lưu cấu hình | Supabase (bảng `portal_config`) |
| Hosting | GitHub Pages |

## Cấu trúc

```
├── index.html      # Toàn bộ giao diện + logic (SPA đơn file)
└── .nojekyll       # Bỏ qua xử lý Jekyll trên GitHub Pages
```

## Triển khai

Repo sử dụng **GitHub Pages** — chỉ cần push lên nhánh `main`, trang sẽ tự động cập nhật.

```
https://vietmedical-vmed.github.io/portal/
```

## Phân quyền (Roles)

| Role | Mô tả |
|---|---|
| `admin` | Quản trị viên — truy cập tất cả + cấu hình portal |
| `manager` | Quản lý |
| `area_manager` | Quản lý vùng |
| `sale_manager` | Quản lý kinh doanh |
| `am` | Account Manager |
| `product_manager` | Product Manager |
| `pm` | Product Manager (viết tắt) |
| `purchasing` | Mua hàng |

Mỗi mục menu có thể giới hạn roles được phép xem. Nếu không chọn role nào, tất cả đều thấy.

## Tác giả

Do Hoang Giang

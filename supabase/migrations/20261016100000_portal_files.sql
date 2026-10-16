-- ════════════════════════════════════════════════════════════════════════
-- Bucket portal-files — file nhúng làm tab trên portal (Excel / PowerPoint / ảnh).
--
--   Private: không có policy cho anon/authenticated. Mọi thao tác đi qua Edge Function
--   portal-files (service role):
--     upload_url → admin xin signed upload URL, trình duyệt PUT file thẳng lên Storage.
--     sign       → user đã login xin signed URL (2h) để xem, kiểm tra roles của mục menu.
--     delete     → admin xoá file khi xoá / thay file của mục menu.
--
--   Giới hạn khớp với Office Online viewer: Excel ≤ 5 MB, PowerPoint ≤ 10 MB.
--   Edge Function kiểm tra chi tiết theo loại; bucket chặn trần 10 MB.
--
-- THỨ TỰ DEPLOY: chạy file này → deploy portal-files → push index.html.
-- Áp dụng: dán vào SQL Editor → Run.
-- ════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'portal-files', 'portal-files', false, 10485760,
  array[
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel.sheet.macroEnabled.12',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-powerpoint',
    'image/png', 'image/jpeg', 'image/gif', 'image/webp'
  ]
)
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ─── KIỂM TRA ─────────────────────────────────────────────────────────────
-- select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'portal-files';

-- ─── ROLLBACK ─────────────────────────────────────────────────────────────
-- Xoá file trước (Dashboard → Storage → portal-files → chọn tất cả → Delete), rồi:
-- delete from storage.buckets where id = 'portal-files';

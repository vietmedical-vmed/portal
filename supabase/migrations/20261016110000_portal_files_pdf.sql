-- ════════════════════════════════════════════════════════════════════════
-- Bucket portal-files nhận thêm PDF (≤ 10 MB, trần bucket giữ nguyên).
-- Đi kèm: deploy lại portal-files + push index.html.
-- ════════════════════════════════════════════════════════════════════════

update storage.buckets
set allowed_mime_types = array_append(allowed_mime_types, 'application/pdf')
where id = 'portal-files'
  and not ('application/pdf' = any (allowed_mime_types));

-- ─── KIỂM TRA ─────────────────────────────────────────────────────────────
-- select allowed_mime_types from storage.buckets where id = 'portal-files';

-- ─── ROLLBACK ─────────────────────────────────────────────────────────────
-- update storage.buckets set allowed_mime_types = array_remove(allowed_mime_types, 'application/pdf')
--   where id = 'portal-files';

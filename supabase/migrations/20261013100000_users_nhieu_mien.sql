-- ════════════════════════════════════════════════════════════════════════
-- shared.users.mien cho phép NHIỀU miền ("MB, MT") — area_manager phụ trách nhiều miền.
--
-- Giống bước nhiều BU (20261006000000_admin_users.sql): generated column mien_ref + FK
-- so nguyên chuỗi nên chặn danh sách → bỏ, thay bằng trigger validate từng mã với dm_mien.
-- Lưu ý: order/sql/16_master_data_fk.sql tạo lại mien_ref nếu chạy lại script đó.
--
-- Đi kèm (deploy SAU khi chạy file này):
--   sale-target  : migration 20261013100000_area_manager_nhieu_mien.sql + sale_target-api
--   order        : order-api + frontend (push master)
--   ccdc / contract : ccdc-api, contract-api
--   portal       : admin-users + index.html
-- ════════════════════════════════════════════════════════════════════════

begin;

alter table shared.users drop constraint if exists fk_users_mien_ref;
alter table shared.users drop column if exists mien_ref;

create or replace function shared.trg_users_validate_mien() returns trigger
language plpgsql
set search_path = ''
as $$
declare bad text;
begin
  if upper(btrim(coalesce(new.mien, ''))) in ('', 'ALL', 'BOTH') then
    return new;
  end if;
  select string_agg(s.x, ', ') into bad
  from (select btrim(unnest(string_to_array(new.mien, ','))) as x) s
  where s.x <> ''
    and not exists (select 1 from shared.dm_mien d where d.ma_mien = s.x);
  if bad is not null then
    raise exception 'invalid_mien: %', bad using errcode = '23503';
  end if;
  return new;
end $$;

drop trigger if exists users_validate_mien on shared.users;
create trigger users_validate_mien
  before insert or update of mien on shared.users
  for each row execute function shared.trg_users_validate_mien();

commit;

-- ─── KIỂM TRA ─────────────────────────────────────────────────────────────
-- update shared.users set mien = 'MB, XX' where false;   -- thử: phải lỗi invalid_mien

-- ─── ROLLBACK (chỉ chạy được khi không còn user nhiều miền) ─────────────────
-- begin;
-- drop trigger if exists users_validate_mien on shared.users;
-- drop function if exists shared.trg_users_validate_mien();
-- alter table shared.users add column mien_ref text generated always as (
--   case when upper(btrim(coalesce(mien, ''))) = any (array['', 'ALL', 'BOTH']) then null else mien end) stored;
-- alter table shared.users add constraint fk_users_mien_ref foreign key (mien_ref) references shared.dm_mien (ma_mien);
-- commit;

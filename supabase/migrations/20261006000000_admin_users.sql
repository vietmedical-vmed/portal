-- ════════════════════════════════════════════════════════════════════════
-- Quản lý tài khoản (portal admin) — chuẩn bị shared.users
--
--   1. Cột khoá tài khoản `active` + audit (created_at/created_by/updated_by).
--      order-login và kpi login ĐÃ check `user.active === false` → có hiệu lực ngay.
--      sale_target-login, contract-login, ccdc-login cần redeploy bản có check active.
--   2. Chuẩn hoá role về chữ thường (cả 5 app đều toLowerCase() khi so sánh).
--   3. Unique không phân biệt hoa/thường cho username.
--   4. Cho phép users.bu nhiều BU ("chcs, cttm"): bỏ generated column bu_ref + FK
--      (FK so nguyên chuỗi nên chặn danh sách), thay bằng trigger validate từng mã.
--      Lưu ý: order/sql/16_master_data_fk.sql tạo lại bu_ref nếu chạy lại script đó.
--
-- THỨ TỰ DEPLOY: chạy file này TRƯỚC khi deploy các login function có select `active`.
-- Áp dụng: dán vào SQL Editor → Run.
-- ════════════════════════════════════════════════════════════════════════

begin;

-- 1. Khoá tài khoản + audit -------------------------------------------------
alter table shared.users
  add column if not exists active     boolean     not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists created_by text,
  add column if not exists updated_by text;

comment on column shared.users.active     is 'false = tài khoản bị khoá, mọi login function phải từ chối.';
comment on column shared.users.created_by is 'username admin tạo tài khoản (portal admin-users).';
comment on column shared.users.updated_by is 'username admin sửa gần nhất (portal admin-users).';

-- 2. Role chữ thường --------------------------------------------------------
update shared.users set role = lower(btrim(role)) where role <> lower(btrim(role));

-- 3. Username unique không phân biệt hoa/thường ------------------------------
do $$
declare dups text;
begin
  select string_agg(k, ', ') into dups
  from (select lower(username) as k from shared.users group by 1 having count(*) > 1) d;
  if dups is not null then
    raise exception 'Trùng username khác hoa/thường, xử lý tay trước: %', dups;
  end if;
end $$;

create unique index if not exists users_username_lower_uq on shared.users (lower(username));

-- 4. Nhiều BU ---------------------------------------------------------------
alter table shared.users drop constraint if exists fk_users_bu_ref;
alter table shared.users drop column if exists bu_ref;

create or replace function shared.trg_users_validate_bu() returns trigger
language plpgsql
set search_path = ''
as $$
declare bad text;
begin
  if lower(btrim(coalesce(new.bu, ''))) in ('', 'all') then
    return new;
  end if;
  select string_agg(s.x, ', ') into bad
  from (select btrim(unnest(string_to_array(new.bu, ','))) as x) s
  where s.x <> ''
    and not exists (select 1 from shared.dm_bu d where d.bu_code = s.x);
  if bad is not null then
    raise exception 'invalid_bu: %', bad using errcode = '23503';
  end if;
  return new;
end $$;

drop trigger if exists users_validate_bu on shared.users;
create trigger users_validate_bu
  before insert or update of bu on shared.users
  for each row execute function shared.trg_users_validate_bu();

commit;

-- ─── KIỂM TRA ─────────────────────────────────────────────────────────────
-- select column_name, data_type, is_nullable from information_schema.columns
--   where table_schema = 'shared' and table_name = 'users' order by ordinal_position;
-- select distinct role from shared.users;                     -- toàn chữ thường
-- update shared.users set bu = 'chcs, xxx' where false;       -- thử: phải lỗi invalid_bu

-- ─── ROLLBACK ─────────────────────────────────────────────────────────────
-- begin;
-- drop trigger if exists users_validate_bu on shared.users;
-- drop function if exists shared.trg_users_validate_bu();
-- -- chỉ chạy được khi không còn user nhiều BU:
-- alter table shared.users add column bu_ref text generated always as (
--   case when lower(btrim(coalesce(bu, ''))) = any (array['', 'all']) then null else bu end) stored;
-- alter table shared.users add constraint fk_users_bu_ref foreign key (bu_ref) references shared.dm_bu (bu_code);
-- drop index if exists shared.users_username_lower_uq;
-- alter table shared.users drop column if exists updated_by, drop column if exists created_by,
--   drop column if exists created_at, drop column if exists active;
-- commit;

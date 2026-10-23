-- =====================================================================
--  DAVOMAT — ko'p tashkilotli (SaaS) versiya. Supabase / PostgreSQL.
--  Ushbu faylni Supabase → SQL Editor ga to'liq joylab, RUN bosing.
--  Qayta ishga tushirish xavfsiz: ma'lumotlar o'chmaydi, funksiyalar yangilanadi.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- Barcha jadvallar "dv" sxemasida. U tashqi API ga ochilmaydi:
-- brauzer faqat public.api() funksiyasini chaqira oladi.
create schema if not exists dv;
revoke all on schema dv from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname='anon') then execute 'revoke all on schema dv from anon'; end if;
  if exists (select 1 from pg_roles where rolname='authenticated') then execute 'revoke all on schema dv from authenticated'; end if;
end $$;

-- ---------------------------------------------------------------- JADVALLAR
create table if not exists dv.app_settings(
  key   text primary key,
  value jsonb not null
);

create table if not exists dv.orgs(
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique check (code ~ '^[a-z0-9][a-z0-9-]{1,30}$'),
  name           text not null,
  short_name     text not null default '',
  logo           text not null default '',
  color          text not null default '#315fca',
  tz             text not null default 'Asia/Tashkent',
  plan_name      text not null default '',
  max_users      int  not null default 50,
  price_month    numeric(14,2) not null default 0,
  paid_until     date not null default (current_date + 14),
  active         boolean not null default true,
  contact_name   text not null default '',
  contact_phone  text not null default '',
  notes          text not null default '',
  office_lat     double precision,
  office_lon     double precision,
  office_radius_m int,
  daily_limit    int not null default 0,
  created_at     timestamptz not null default now()
);

create table if not exists dv.users(
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid references dv.orgs(id) on delete cascade,
  role            text not null check (role in ('superadmin','admin','employee')),
  full_name       text not null,
  username        text not null,
  pass_hash       text not null,
  department      text not null default '',
  position        text not null default '',
  device_id       text,
  device_fp       text,
  device_info     text not null default '',
  device_bound_at timestamptz,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  constraint users_role_org check ((role = 'superadmin') = (org_id is null))
);
create unique index if not exists users_org_username
  on dv.users (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(username));

create table if not exists dv.sessions(
  token_hash text primary key,
  user_id    uuid not null references dv.users(id) on delete cascade,
  device_id  text not null default '',
  created_at timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists sessions_user on dv.sessions(user_id);

create table if not exists dv.attendance(
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references dv.orgs(id) on delete cascade,
  user_id     uuid not null references dv.users(id) on delete cascade,
  note        text not null default '',
  lat         double precision not null,
  lon         double precision not null,
  accuracy    int not null default 0,
  distance_m  int,
  sent_at     timestamptz not null default now(),
  status      text not null default 'Kutilmoqda' check (status in ('Kutilmoqda','Tasdiqlandi','Rad etildi')),
  decided_at  timestamptz,
  decided_by  uuid,
  admin_note  text not null default ''
);
create index if not exists att_org_sent  on dv.attendance(org_id, sent_at desc);
create index if not exists att_user_sent on dv.attendance(user_id, sent_at desc);
create index if not exists att_org_pending on dv.attendance(org_id) where status = 'Kutilmoqda';

create table if not exists dv.payments(
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references dv.orgs(id) on delete cascade,
  amount      numeric(14,2) not null default 0,
  months      int not null,
  period_from date not null,
  period_to   date not null,
  method      text not null default '',
  note        text not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists payments_org on dv.payments(org_id, created_at desc);

create table if not exists dv.login_attempts(
  k  text not null,
  at timestamptz not null default now()
);
create index if not exists login_attempts_k on dv.login_attempts(k, at);

-- Himoya: jadvallarga to'g'ridan-to'g'ri kirish butunlay yopiq (RLS yoqilgan, siyosat yo'q).
alter table dv.app_settings   enable row level security;
alter table dv.orgs           enable row level security;
alter table dv.users          enable row level security;
alter table dv.sessions       enable row level security;
alter table dv.attendance     enable row level security;
alter table dv.payments       enable row level security;
alter table dv.login_attempts enable row level security;

insert into dv.app_settings(key, value) values
  ('payment_info',  to_jsonb('To‘lov uchun rekvizitlar: (super-admin Sozlamalar bo‘limida yozadi)'::text)),
  ('support_phone', to_jsonb(''::text)),
  ('trial_days',    to_jsonb(14)),
  ('plans', '[{"name":"Start","max_users":30,"price":150000},{"name":"Biznes","max_users":100,"price":350000},{"name":"Korporativ","max_users":500,"price":900000}]'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------- YORDAMCHI FUNKSIYALAR
create or replace function dv.fail(msg text, code text default null) returns void
language plpgsql as $$
begin
  if code is null then raise exception using message = msg;
  else raise exception using message = msg, hint = code; end if;
end $$;

create or replace function dv.setting(k text) returns jsonb
language sql stable set search_path = dv, pg_temp as $$
  select value from dv.app_settings where key = k
$$;

create or replace function dv.dist_m(lat1 float8, lon1 float8, lat2 float8, lon2 float8) returns float8
language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2 - lon1) / 2), 2)))
$$;

create or replace function dv.hash_pw(pw text) returns text
language sql volatile set search_path = extensions, pg_temp as $$
  select crypt(pw, gen_salt('bf', 8))
$$;

create or replace function dv.check_pw(pw text, h text) returns boolean
language sql stable set search_path = extensions, pg_temp as $$
  select h is not null and h = crypt(pw, h)
$$;

create or replace function dv.token_hash(t text) returns text
language sql immutable set search_path = extensions, pg_temp as $$
  select encode(digest(coalesce(t, ''), 'sha256'), 'hex')
$$;

create or replace function dv.valid_username(un text) returns text
language plpgsql as $$
begin
  un := lower(trim(coalesce(un, '')));
  if un !~ '^[a-z0-9._-]{3,32}$' then
    perform dv.fail('Login 3–32 belgidan iborat bo‘lsin: lotin harflari, raqamlar, nuqta, tire yoki pastki chiziq.');
  end if;
  return un;
end $$;

create or replace function dv.valid_password(pw text) returns text
language plpgsql as $$
begin
  if length(coalesce(pw, '')) < 6 then perform dv.fail('Parol kamida 6 belgidan iborat bo‘lsin.'); end if;
  if length(pw) > 72 then perform dv.fail('Parol juda uzun.'); end if;
  return pw;
end $$;

create or replace function dv.month_range(m text, tz text, out t0 timestamptz, out t1 timestamptz)
language plpgsql stable as $$
declare d date;
begin
  if coalesce(m, '') !~ '^\d{4}-\d{2}$' then
    d := date_trunc('month', (now() at time zone tz))::date;
  else
    d := to_date(m || '-01', 'YYYY-MM-DD');
  end if;
  t0 := d::timestamp at time zone tz;
  t1 := (d + interval '1 month')::timestamp at time zone tz;
end $$;

create or replace function dv.user_pub(u dv.users) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', u.id, 'full_name', u.full_name, 'username', u.username,
    'department', u.department, 'position', u.position, 'role', u.role,
    'device_info', u.device_info, 'active', u.active)
$$;

create or replace function dv.org_pub(o dv.orgs) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', o.id, 'code', o.code, 'name', o.name, 'short_name', o.short_name,
    'logo', o.logo, 'color', o.color, 'tz', o.tz, 'plan_name', o.plan_name, 'max_users', o.max_users,
    'paid_until', o.paid_until,
    'days_left', o.paid_until - (now() at time zone o.tz)::date,
    'expired', o.paid_until < (now() at time zone o.tz)::date,
    'office_lat', o.office_lat, 'office_lon', o.office_lon, 'office_radius_m', o.office_radius_m,
    'daily_limit', o.daily_limit, 'support_phone', dv.setting('support_phone'))
$$;

-- ---------------------------------------------------------------- OCHIQ AMALLAR
create or replace function dv.a_org_public(p jsonb) returns jsonb
language plpgsql stable as $$
declare o dv.orgs;
begin
  select * into o from dv.orgs where code = lower(trim(coalesce(p->>'org', '')));
  if not found then perform dv.fail('Tashkilot kodi topilmadi.'); end if;
  return jsonb_build_object('org', jsonb_build_object('code', o.code, 'name', o.name,
    'short_name', o.short_name, 'logo', o.logo, 'color', o.color, 'active', o.active));
end $$;

create or replace function dv.a_login(p jsonb) returns jsonb
language plpgsql as $$
declare
  oc   text := lower(trim(coalesce(p->>'org', '')));
  un   text := lower(trim(coalesce(p->>'username', '')));
  pw   text := coalesce(p->>'password', '');
  did  text := trim(coalesce(p->>'device_id', ''));
  fp   text := trim(coalesce(p->>'device_fp', ''));
  info text := left(coalesce(p->>'device_info', ''), 200);
  lk   text := oc || '|' || un;
  o dv.orgs; u dv.users; tok text;
begin
  if un = '' or pw = '' then perform dv.fail('Login va parolni kiriting.'); end if;
  if (select count(*) from dv.login_attempts where login_attempts.k = lk and at > now() - interval '15 minutes') >= 8 then
    perform dv.fail('Juda ko‘p noto‘g‘ri urinish. 15 daqiqadan keyin qayta urinib ko‘ring.');
  end if;

  if oc = '' then
    select * into u from dv.users where org_id is null and role = 'superadmin' and lower(username) = un;
  else
    select * into o from dv.orgs where code = oc;
    if not found then return jsonb_build_object('ok', false, 'message', 'Tashkilot kodi noto‘g‘ri.'); end if;
    select * into u from dv.users where org_id = o.id and lower(username) = un;
  end if;

  if u.id is null or not dv.check_pw(pw, u.pass_hash) then
    insert into dv.login_attempts(k) values (lk);
    delete from dv.login_attempts where at < now() - interval '1 day';
    return jsonb_build_object('ok', false, 'message', 'Login yoki parol noto‘g‘ri.');
  end if;
  if not u.active then perform dv.fail('Akkauntingiz faol emas. Administratorga murojaat qiling.'); end if;
  if o.id is not null and not o.active then perform dv.fail('Tashkilot akkaunti to‘xtatilgan. Xizmat ko‘rsatuvchiga murojaat qiling.'); end if;

  -- Bir xodim = bitta telefon. Adminlar va super-admin qurilmaga bog'lanmaydi.
  if u.role = 'employee' then
    if length(did) < 20 then perform dv.fail('Qurilma aniqlanmadi. Dasturni yangilang.'); end if;
    if u.device_id is null then
      update dv.users set device_id = did, device_fp = fp, device_info = info, device_bound_at = now() where id = u.id;
      u.device_id := did;
    elsif u.device_id <> did or (coalesce(u.device_fp, '') <> '' and u.device_fp <> fp) then
      return jsonb_build_object('ok', false, 'message',
        'Bu login boshqa telefonga biriktirilgan. Faqat o‘z telefoningizdan kiring yoki administrator “Telefonni almashtirish” tugmasini bossin.');
    end if;
  end if;

  delete from dv.login_attempts where login_attempts.k = lk;
  delete from dv.sessions where user_id = u.id and expires_at < now();
  tok := encode(extensions.gen_random_bytes(32), 'hex');
  insert into dv.sessions(token_hash, user_id, device_id, expires_at)
    values (dv.token_hash(tok), u.id, did, now() + interval '30 days');

  return jsonb_build_object('token', tok, 'user', dv.user_pub(u),
    'org', case when o.id is null then null else dv.org_pub(o) end);
end $$;

-- ---------------------------------------------------------------- UMUMIY
create or replace function dv.a_change_password(u dv.users, p jsonb, th text) returns jsonb
language plpgsql as $$
declare np text := dv.valid_password(p->>'new');
begin
  if not dv.check_pw(coalesce(p->>'old', ''), u.pass_hash) then perform dv.fail('Joriy parol noto‘g‘ri.'); end if;
  if np = p->>'old' then perform dv.fail('Yangi parol eskisidan farq qilishi kerak.'); end if;
  update dv.users set pass_hash = dv.hash_pw(np) where id = u.id;
  delete from dv.sessions where user_id = u.id and token_hash <> th;  -- boshqa seanslar yopiladi
  return '{}'::jsonb;
end $$;

-- ---------------------------------------------------------------- XODIM
create or replace function dv.a_submit(u dv.users, o dv.orgs, p jsonb) returns jsonb
language plpgsql as $$
declare
  lat float8; lon float8; acc int; dist int; nid uuid;
  day0 timestamptz := ((now() at time zone o.tz)::date)::timestamp at time zone o.tz;
begin
  begin
    lat := (p->>'lat')::float8; lon := (p->>'lon')::float8; acc := coalesce(round((p->>'accuracy')::float8), 0);
  exception when others then perform dv.fail('Lokatsiya noto‘g‘ri.'); end;
  if lat is null or lon is null or lat not between -90 and 90 or lon not between -180 and 180 then
    perform dv.fail('Lokatsiya olinmadi.');
  end if;
  if exists (select 1 from dv.attendance where user_id = u.id and sent_at > now() - interval '2 minutes') then
    perform dv.fail('Siz hozirgina ma’lumot yubordingiz. 2 daqiqadan keyin qayta urinib ko‘ring.');
  end if;
  if o.daily_limit > 0 and (select count(*) from dv.attendance where user_id = u.id and sent_at >= day0) >= o.daily_limit then
    perform dv.fail('Bugun uchun ruxsat etilgan yuborishlar soni (' || o.daily_limit || ') tugadi.');
  end if;
  if o.office_lat is not null and o.office_lon is not null then
    dist := round(dv.dist_m(lat, lon, o.office_lat, o.office_lon));
  end if;
  insert into dv.attendance(org_id, user_id, note, lat, lon, accuracy, distance_m)
    values (o.id, u.id, left(coalesce(p->>'note', ''), 1000), lat, lon, acc, dist)
    returning id into nid;
  return jsonb_build_object('id', nid, 'status', 'Kutilmoqda', 'distance_m', dist,
    'outside', (o.office_radius_m is not null and dist is not null and dist > o.office_radius_m));
end $$;

create or replace function dv.a_my_attendance(u dv.users, o dv.orgs, p jsonb) returns jsonb
language plpgsql stable as $$
declare r record;
begin
  select * into r from dv.month_range(p->>'month', o.tz);
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object('id', a.id, 'sent_at', a.sent_at, 'decided_at', a.decided_at,
      'note', a.note, 'status', a.status, 'admin_note', a.admin_note, 'lat', a.lat, 'lon', a.lon,
      'accuracy', a.accuracy, 'distance_m', a.distance_m) order by a.sent_at desc)
    from dv.attendance a where a.user_id = u.id and a.sent_at >= r.t0 and a.sent_at < r.t1), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- TASHKILOT ADMINI
create or replace function dv.a_dashboard(u dv.users, o dv.orgs, p jsonb) returns jsonb
language plpgsql stable as $$
declare
  r record; d date; d0 timestamptz; d1 timestamptz; daily jsonb; monthly jsonb; pend int;
begin
  select * into r from dv.month_range(p->>'month', o.tz);
  begin d := coalesce(nullif(p->>'date', '')::date, (now() at time zone o.tz)::date);
  exception when others then d := (now() at time zone o.tz)::date; end;
  d0 := d::timestamp at time zone o.tz; d1 := (d + 1)::timestamp at time zone o.tz;

  select coalesce(jsonb_agg(x order by x->>'full_name'), '[]'::jsonb) into daily from (
    select jsonb_build_object('id', e.id, 'full_name', e.full_name, 'department', e.department, 'position', e.position,
      'count', count(a.id), 'first', min(a.sent_at), 'last', max(a.sent_at),
      'outside', bool_or(o.office_radius_m is not null and a.distance_m > o.office_radius_m)) x
    from dv.users e
    left join dv.attendance a on a.user_id = e.id and a.sent_at >= d0 and a.sent_at < d1
    where e.org_id = o.id and e.role = 'employee' and e.active
    group by e.id) q;

  select coalesce(jsonb_agg(x order by x->>'full_name'), '[]'::jsonb) into monthly from (
    select jsonb_build_object('id', e.id, 'full_name', e.full_name, 'department', e.department,
      'total', count(a.id),
      'days', count(distinct (a.sent_at at time zone o.tz)::date),
      'approved', count(a.id) filter (where a.status = 'Tasdiqlandi'),
      'rejected', count(a.id) filter (where a.status = 'Rad etildi'),
      'pending',  count(a.id) filter (where a.status = 'Kutilmoqda')) x
    from dv.users e
    left join dv.attendance a on a.user_id = e.id and a.sent_at >= r.t0 and a.sent_at < r.t1
    where e.org_id = o.id and e.role = 'employee' and e.active
    group by e.id) q;

  select count(*) into pend from dv.attendance where org_id = o.id and status = 'Kutilmoqda';

  return jsonb_build_object('date', d, 'month', to_char(r.t0 at time zone o.tz, 'YYYY-MM'),
    'daily', daily, 'monthly', monthly, 'pending_total', pend);
end $$;

create or replace function dv.a_users_list(u dv.users, o dv.orgs) returns jsonb
language sql stable as $$
  select jsonb_build_object('items', coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'full_name', e.full_name, 'username', e.username, 'department', e.department,
      'position', e.position, 'role', e.role, 'active', e.active,
      'device_bound', e.device_id is not null, 'device_info', e.device_info, 'device_bound_at', e.device_bound_at,
      'is_me', e.id = u.id)
    order by e.role, e.full_name), '[]'::jsonb),
    'max_users', o.max_users,
    'active_employees', (select count(*) from dv.users x where x.org_id = o.id and x.role = 'employee' and x.active))
  from dv.users e where e.org_id = o.id
$$;

create or replace function dv.check_limit(o dv.orgs, extra int default 1) returns void
language plpgsql as $$
declare n int;
begin
  select count(*) into n from dv.users where org_id = o.id and role = 'employee' and active;
  if n + extra > o.max_users then
    perform dv.fail('Tarifingiz bo‘yicha faol xodimlar soni ' || o.max_users || ' tadan oshmasligi kerak. Tarifni oshirish uchun xizmat ko‘rsatuvchiga murojaat qiling.', 'LIMIT');
  end if;
end $$;

create or replace function dv.a_user_save(u dv.users, o dv.orgs, p jsonb) returns jsonb
language plpgsql as $$
declare
  uid uuid := nullif(p->>'id', '')::uuid;
  un text := dv.valid_username(p->>'username');
  rl text := coalesce(nullif(p->>'role', ''), 'employee');
  fn text := trim(coalesce(p->>'full_name', ''));
  pw text := coalesce(p->>'password', '');
  cur dv.users;
begin
  if fn = '' then perform dv.fail('F.I.Sh. kiritilishi shart.'); end if;
  if rl not in ('employee', 'admin') then perform dv.fail('Rol noto‘g‘ri.'); end if;
  if exists (select 1 from dv.users where org_id = o.id and lower(username) = un and id is distinct from uid) then
    perform dv.fail('Bu login band. Boshqa login tanlang.');
  end if;
  if uid is null then
    perform dv.valid_password(pw);
    if rl = 'employee' then perform dv.check_limit(o); end if;
    insert into dv.users(org_id, role, full_name, username, pass_hash, department, position)
      values (o.id, rl, fn, un, dv.hash_pw(pw), trim(coalesce(p->>'department', '')), trim(coalesce(p->>'position', '')))
      returning id into uid;
  else
    select * into cur from dv.users where id = uid and org_id = o.id;
    if not found then perform dv.fail('Xodim topilmadi.'); end if;
    if cur.id = u.id and rl <> 'admin' then perform dv.fail('O‘zingizni adminlikdan chiqara olmaysiz.'); end if;
    if cur.role = 'admin' and rl = 'employee' and cur.active then perform dv.check_limit(o); end if;
    update dv.users set full_name = fn, username = un, role = rl,
      department = trim(coalesce(p->>'department', '')), position = trim(coalesce(p->>'position', ''))
      where id = uid;
    if pw <> '' then
      update dv.users set pass_hash = dv.hash_pw(dv.valid_password(pw)) where id = uid;
      delete from dv.sessions where user_id = uid;
    end if;
  end if;
  return jsonb_build_object('id', uid);
end $$;

create or replace function dv.a_users_import(u dv.users, o dv.orgs, p jsonb) returns jsonb
language plpgsql as $$
declare
  rw jsonb; un text; created int := 0; skipped jsonb := '[]'::jsonb;
  free int;
begin
  if jsonb_typeof(p->'rows') <> 'array' then perform dv.fail('Fayl bo‘sh.'); end if;
  if jsonb_array_length(p->'rows') > 1000 then perform dv.fail('Bir martada 1000 tadan ko‘p qator yuklab bo‘lmaydi.'); end if;
  select o.max_users - count(*) into free from dv.users where org_id = o.id and role = 'employee' and active;
  for rw in select * from jsonb_array_elements(p->'rows') loop
    un := lower(trim(coalesce(rw->>'username', '')));
    if un !~ '^[a-z0-9._-]{3,32}$' then
      skipped := skipped || jsonb_build_object('username', un, 'reason', 'login noto‘g‘ri'); continue; end if;
    if length(coalesce(rw->>'password', '')) < 6 then
      skipped := skipped || jsonb_build_object('username', un, 'reason', 'parol 6 belgidan qisqa'); continue; end if;
    if trim(coalesce(rw->>'full_name', '')) = '' then
      skipped := skipped || jsonb_build_object('username', un, 'reason', 'F.I.Sh. yo‘q'); continue; end if;
    if exists (select 1 from dv.users where org_id = o.id and lower(username) = un) then
      skipped := skipped || jsonb_build_object('username', un, 'reason', 'login band'); continue; end if;
    if free <= 0 then
      skipped := skipped || jsonb_build_object('username', un, 'reason', 'tarif limiti'); continue; end if;
    insert into dv.users(org_id, role, full_name, username, pass_hash, department, position)
      values (o.id, 'employee', trim(rw->>'full_name'), un, dv.hash_pw(rw->>'password'),
              trim(coalesce(rw->>'department', '')), trim(coalesce(rw->>'position', '')));
    created := created + 1; free := free - 1;
  end loop;
  return jsonb_build_object('created', created, 'skipped', skipped);
end $$;

create or replace function dv.a_user_reset_device(u dv.users, o dv.orgs, p jsonb) returns jsonb
language plpgsql as $$
declare uid uuid := nullif(p->>'id', '')::uuid;
begin
  update dv.users set device_id = null, device_fp = null, device_info = '', device_bound_at = null
    where id = uid and org_id = o.id;
  if not found then perform dv.fail('Xodim topilmadi.'); end if;
  delete from dv.sessions where user_id = uid;
  return '{}'::jsonb;
end $$;

create or replace function dv.a_user_toggle(u dv.users, o dv.orgs, p jsonb) returns jsonb
language plpgsql as $$
declare uid uuid := nullif(p->>'id', '')::uuid; act boolean := coalesce((p->>'active')::boolean, false); cur dv.users;
begin
  select * into cur from dv.users where id = uid and org_id = o.id;
  if not found then perform dv.fail('Xodim topilmadi.'); end if;
  if cur.id = u.id then perform dv.fail('O‘zingizni faolsizlantira olmaysiz.'); end if;
  if act and not cur.active and cur.role = 'employee' then perform dv.check_limit(o); end if;
  update dv.users set active = act where id = uid;
  if not act then delete from dv.sessions where user_id = uid; end if;
  return '{}'::jsonb;
end $$;

create or replace function dv.a_att_list(u dv.users, o dv.orgs, p jsonb) returns jsonb
language plpgsql stable as $$
declare r record; st text := nullif(p->>'status', ''); fu uuid := nullif(p->>'user_id', '')::uuid; allm boolean := st = 'Kutilmoqda' and coalesce(p->>'month', '') = '';
begin
  select * into r from dv.month_range(p->>'month', o.tz);
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object('id', a.id, 'user_id', a.user_id, 'full_name', e.full_name,
      'department', e.department, 'position', e.position, 'note', a.note, 'lat', a.lat, 'lon', a.lon,
      'accuracy', a.accuracy, 'distance_m', a.distance_m,
      'outside', (o.office_radius_m is not null and a.distance_m > o.office_radius_m),
      'sent_at', a.sent_at, 'decided_at', a.decided_at, 'status', a.status, 'admin_note', a.admin_note)
      order by a.sent_at desc)
    from (select * from dv.attendance a
          where a.org_id = o.id
            and (allm or (a.sent_at >= r.t0 and a.sent_at < r.t1))
            and (st is null or a.status = st)
            and (fu is null or a.user_id = fu)
          order by a.sent_at desc limit 5000) a
    join dv.users e on e.id = a.user_id), '[]'::jsonb));
end $$;

create or replace function dv.a_att_decide(u dv.users, o dv.orgs, p jsonb) returns jsonb
language plpgsql as $$
declare dec text := p->>'decision'; n int;
begin
  if dec not in ('Tasdiqlandi', 'Rad etildi') then perform dv.fail('Qaror noto‘g‘ri.'); end if;
  update dv.attendance set status = dec, decided_at = now(), decided_by = u.id,
    admin_note = left(coalesce(p->>'admin_note', ''), 500)
  where org_id = o.id and id in (select (jsonb_array_elements_text(p->'ids'))::uuid);
  get diagnostics n = row_count;
  return jsonb_build_object('updated', n);
end $$;

create or replace function dv.a_org_settings_save(u dv.users, o dv.orgs, p jsonb) returns jsonb
language plpgsql as $$
declare lg text := coalesce(p->>'logo', o.logo); cl text := coalesce(nullif(p->>'color', ''), o.color);
begin
  if lg <> '' and (lg !~ '^data:image/(png|jpeg|webp);base64,' or length(lg) > 300000) then
    perform dv.fail('Logo rasmi noto‘g‘ri yoki juda katta.');
  end if;
  if cl !~ '^#[0-9a-fA-F]{6}$' then perform dv.fail('Rang noto‘g‘ri.'); end if;
  if trim(coalesce(p->>'name', '')) = '' then perform dv.fail('Tashkilot nomi kiritilishi shart.'); end if;
  update dv.orgs set
    name = trim(p->>'name'),
    short_name = trim(coalesce(p->>'short_name', '')),
    logo = lg, color = cl,
    office_lat = nullif(p->>'office_lat', '')::float8,
    office_lon = nullif(p->>'office_lon', '')::float8,
    office_radius_m = nullif(p->>'office_radius_m', '')::int,
    daily_limit = greatest(0, coalesce(nullif(p->>'daily_limit', '')::int, 0))
  where id = o.id
  returning * into o;
  return jsonb_build_object('org', dv.org_pub(o));
end $$;

create or replace function dv.a_billing(o dv.orgs) returns jsonb
language sql stable as $$
  select jsonb_build_object('org', dv.org_pub(o),
    'price_month', o.price_month,
    'active_employees', (select count(*) from dv.users where org_id = o.id and role = 'employee' and active),
    'payment_info', dv.setting('payment_info'),
    'plans', dv.setting('plans'),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('created_at', created_at, 'amount', amount, 'months', months,
        'period_from', period_from, 'period_to', period_to, 'method', method) order by created_at desc)
      from dv.payments where org_id = o.id), '[]'::jsonb))
$$;

-- ---------------------------------------------------------------- SUPER-ADMIN (dastur egasi)
create or replace function dv.a_sa_overview() returns jsonb
language sql stable as $$
  with o as (
    select o.*, (now() at time zone o.tz)::date as today from dv.orgs o
  ), x as (
    select o.id, jsonb_build_object('id', o.id, 'code', o.code, 'name', o.name, 'short_name', o.short_name,
      'plan_name', o.plan_name, 'max_users', o.max_users, 'price_month', o.price_month,
      'paid_until', o.paid_until, 'days_left', o.paid_until - o.today, 'active', o.active, 'tz', o.tz,
      'contact_name', o.contact_name, 'contact_phone', o.contact_phone, 'notes', o.notes,
      'created_at', o.created_at,
      'employees', (select count(*) from dv.users e where e.org_id = o.id and e.role = 'employee' and e.active),
      'admins', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'username', e.username, 'full_name', e.full_name, 'active', e.active)), '[]'::jsonb)
                 from dv.users e where e.org_id = o.id and e.role = 'admin'),
      'today', (select count(*) from dv.attendance a where a.org_id = o.id and a.sent_at >= o.today::timestamp at time zone o.tz),
      'last_activity', (select max(a.sent_at) from dv.attendance a where a.org_id = o.id)) j,
      o.active, o.paid_until, o.today, o.price_month
    from o
  )
  select jsonb_build_object(
    'orgs', coalesce((select jsonb_agg(j order by j->>'name') from x), '[]'::jsonb),
    'totals', jsonb_build_object(
      'orgs', (select count(*) from x),
      'active', (select count(*) from x where active and paid_until >= today),
      'expired', (select count(*) from x where active and paid_until < today),
      'expiring', (select count(*) from x where active and paid_until >= today and paid_until - today <= 7),
      'employees', (select count(*) from dv.users where role = 'employee' and active),
      'mrr', (select coalesce(sum(price_month), 0) from x where active and paid_until >= today),
      'revenue_month', (select coalesce(sum(amount), 0) from dv.payments where created_at >= date_trunc('month', now() at time zone 'Asia/Tashkent') at time zone 'Asia/Tashkent'),
      'revenue_total', (select coalesce(sum(amount), 0) from dv.payments)))
$$;

create or replace function dv.a_sa_org_save(p jsonb) returns jsonb
language plpgsql as $$
declare
  oid uuid := nullif(p->>'id', '')::uuid;
  cd text := lower(trim(coalesce(p->>'code', '')));
  o dv.orgs;
  pu date;
begin
  if cd !~ '^[a-z0-9][a-z0-9-]{1,30}$' then
    perform dv.fail('Tashkilot kodi 2–31 belgi bo‘lsin: kichik lotin harflari, raqam va tire (masalan: samqurilish).');
  end if;
  if trim(coalesce(p->>'name', '')) = '' then perform dv.fail('Tashkilot nomi kiritilishi shart.'); end if;
  if exists (select 1 from dv.orgs where code = cd and id is distinct from oid) then perform dv.fail('Bu kod band.'); end if;
  begin pu := nullif(p->>'paid_until', '')::date; exception when others then perform dv.fail('Sana noto‘g‘ri.'); end;

  if oid is null then
    perform dv.valid_username(p->>'admin_username');
    perform dv.valid_password(p->>'admin_password');
    insert into dv.orgs(code, name, short_name, plan_name, max_users, price_month, paid_until, contact_name, contact_phone, notes, tz)
    values (cd, trim(p->>'name'), trim(coalesce(p->>'short_name', '')), coalesce(p->>'plan_name', ''),
      coalesce(nullif(p->>'max_users', '')::int, 30), coalesce(nullif(p->>'price_month', '')::numeric, 0),
      coalesce(pu, current_date + coalesce((dv.setting('trial_days'))::int, 14)),
      coalesce(p->>'contact_name', ''), coalesce(p->>'contact_phone', ''), coalesce(p->>'notes', ''),
      coalesce(nullif(p->>'tz', ''), 'Asia/Tashkent'))
    returning * into o;
    insert into dv.users(org_id, role, full_name, username, pass_hash)
      values (o.id, 'admin', coalesce(nullif(trim(p->>'admin_full_name'), ''), 'Administrator'),
              dv.valid_username(p->>'admin_username'), dv.hash_pw(p->>'admin_password'));
  else
    update dv.orgs set code = cd, name = trim(p->>'name'), short_name = trim(coalesce(p->>'short_name', '')),
      plan_name = coalesce(p->>'plan_name', plan_name),
      max_users = coalesce(nullif(p->>'max_users', '')::int, max_users),
      price_month = coalesce(nullif(p->>'price_month', '')::numeric, price_month),
      paid_until = coalesce(pu, paid_until),
      contact_name = coalesce(p->>'contact_name', contact_name),
      contact_phone = coalesce(p->>'contact_phone', contact_phone),
      notes = coalesce(p->>'notes', notes),
      tz = coalesce(nullif(p->>'tz', ''), tz)
    where id = oid returning * into o;
    if not found then perform dv.fail('Tashkilot topilmadi.'); end if;
  end if;
  return jsonb_build_object('id', o.id);
end $$;

create or replace function dv.a_sa_org_toggle(p jsonb) returns jsonb
language plpgsql as $$
declare oid uuid := nullif(p->>'id', '')::uuid; act boolean := coalesce((p->>'active')::boolean, false);
begin
  update dv.orgs set active = act where id = oid;
  if not found then perform dv.fail('Tashkilot topilmadi.'); end if;
  if not act then delete from dv.sessions where user_id in (select id from dv.users where org_id = oid); end if;
  return '{}'::jsonb;
end $$;

create or replace function dv.a_sa_admin_save(p jsonb) returns jsonb
language plpgsql as $$
declare
  oid uuid := nullif(p->>'org_id', '')::uuid;
  uid uuid := nullif(p->>'user_id', '')::uuid;
  un text := dv.valid_username(p->>'username');
  pw text := coalesce(p->>'password', '');
begin
  if not exists (select 1 from dv.orgs where id = oid) then perform dv.fail('Tashkilot topilmadi.'); end if;
  if exists (select 1 from dv.users where org_id = oid and lower(username) = un and id is distinct from uid) then
    perform dv.fail('Bu login band.');
  end if;
  if uid is null then
    insert into dv.users(org_id, role, full_name, username, pass_hash)
      values (oid, 'admin', coalesce(nullif(trim(p->>'full_name'), ''), 'Administrator'), un, dv.hash_pw(dv.valid_password(pw)))
      returning id into uid;
  else
    update dv.users set username = un, full_name = coalesce(nullif(trim(p->>'full_name'), ''), full_name), active = true
      where id = uid and org_id = oid and role = 'admin';
    if not found then perform dv.fail('Admin topilmadi.'); end if;
    if pw <> '' then
      update dv.users set pass_hash = dv.hash_pw(dv.valid_password(pw)) where id = uid;
      delete from dv.sessions where user_id = uid;
    end if;
  end if;
  return jsonb_build_object('id', uid);
end $$;

create or replace function dv.a_sa_payment_add(p jsonb) returns jsonb
language plpgsql as $$
declare
  o dv.orgs; m int := coalesce(nullif(p->>'months', '')::int, 1);
  pf date; pt date; today date;
begin
  select * into o from dv.orgs where id = nullif(p->>'org_id', '')::uuid for update;
  if not found then perform dv.fail('Tashkilot topilmadi.'); end if;
  if m < 1 or m > 36 then perform dv.fail('Oylar soni 1 dan 36 gacha bo‘lsin.'); end if;
  today := (now() at time zone o.tz)::date;
  pf := greatest(o.paid_until + 1, today);
  pt := (pf + make_interval(months => m))::date - 1;
  insert into dv.payments(org_id, amount, months, period_from, period_to, method, note)
    values (o.id, coalesce(nullif(p->>'amount', '')::numeric, o.price_month * m), m, pf, pt,
            coalesce(p->>'method', ''), coalesce(p->>'note', ''));
  update dv.orgs set paid_until = pt, active = true where id = o.id;
  return jsonb_build_object('paid_until', pt);
end $$;

create or replace function dv.a_sa_payment_delete(p jsonb) returns jsonb
language plpgsql as $$
declare pm dv.payments;
begin
  delete from dv.payments where id = nullif(p->>'id', '')::uuid returning * into pm;
  if not found then perform dv.fail('To‘lov topilmadi.'); end if;
  update dv.orgs set paid_until = pm.period_from - 1 where id = pm.org_id and paid_until = pm.period_to;
  return '{}'::jsonb;
end $$;

create or replace function dv.a_sa_payments(p jsonb) returns jsonb
language sql stable as $$
  select jsonb_build_object('items', coalesce(jsonb_agg(jsonb_build_object('id', pm.id, 'org_id', pm.org_id,
      'org_name', o.name, 'amount', pm.amount, 'months', pm.months, 'period_from', pm.period_from,
      'period_to', pm.period_to, 'method', pm.method, 'note', pm.note, 'created_at', pm.created_at)
    order by pm.created_at desc), '[]'::jsonb))
  from dv.payments pm join dv.orgs o on o.id = pm.org_id
  where nullif(p->>'org_id', '') is null or pm.org_id = (p->>'org_id')::uuid
$$;

create or replace function dv.a_sa_settings_save(p jsonb) returns jsonb
language plpgsql as $$
begin
  if p ? 'payment_info' then
    insert into dv.app_settings values ('payment_info', to_jsonb(coalesce(p->>'payment_info', '')))
    on conflict (key) do update set value = excluded.value; end if;
  if p ? 'support_phone' then
    insert into dv.app_settings values ('support_phone', to_jsonb(coalesce(p->>'support_phone', '')))
    on conflict (key) do update set value = excluded.value; end if;
  if p ? 'trial_days' then
    insert into dv.app_settings values ('trial_days', to_jsonb(greatest(0, coalesce(nullif(p->>'trial_days', '')::int, 14))))
    on conflict (key) do update set value = excluded.value; end if;
  if jsonb_typeof(p->'plans') = 'array' then
    insert into dv.app_settings values ('plans', p->'plans')
    on conflict (key) do update set value = excluded.value; end if;
  return '{}'::jsonb;
end $$;

create or replace function dv.a_sa_settings() returns jsonb
language sql stable as $$
  select jsonb_build_object('payment_info', dv.setting('payment_info'), 'support_phone', dv.setting('support_phone'),
    'trial_days', dv.setting('trial_days'), 'plans', dv.setting('plans'))
$$;

-- ---------------------------------------------------------------- YAGONA KIRISH NUQTASI
-- Brauzer/ilova faqat shu funksiyani chaqiradi: POST /rest/v1/rpc/api  {"p": {"action": "...", ...}}
create or replace function public.api(p jsonb) returns jsonb
language plpgsql security definer
set search_path = dv, extensions, public, pg_temp
as $$
declare
  a text := coalesce(p->>'action', '');
  th text; s dv.sessions; u dv.users; o dv.orgs;
begin
  if a = 'ping' then return jsonb_build_object('ok', true, 'version', 5); end if;
  if a = 'org_public' then return dv.a_org_public(p); end if;
  if a = 'login' then return dv.a_login(p); end if;

  th := dv.token_hash(p->>'token');
  select * into s from dv.sessions where token_hash = th and expires_at > now();
  if not found then perform dv.fail('Sessiya tugagan. Qayta kiring.', 'AUTH'); end if;
  select * into u from dv.users where id = s.user_id;
  if not found or not u.active then perform dv.fail('Akkaunt faol emas. Qayta kiring.', 'AUTH'); end if;
  if u.role = 'employee' and (u.device_id is null or u.device_id <> s.device_id
                              or coalesce(p->>'device_id', '') <> s.device_id) then
    perform dv.fail('Qurilma tasdiqlanmadi yoki administrator qurilmani almashtirgan. Qayta kiring.', 'AUTH');
  end if;
  if s.last_seen < now() - interval '10 minutes' then
    update dv.sessions set last_seen = now(), expires_at = greatest(expires_at, now() + interval '30 days')
      where token_hash = th;
  end if;

  if a = 'logout' then delete from dv.sessions where token_hash = th; return '{}'::jsonb; end if;
  if a = 'change_password' then return dv.a_change_password(u, p, th); end if;

  -- Super-admin
  if u.role = 'superadmin' then
    case a
      when 'me'                then return jsonb_build_object('user', dv.user_pub(u), 'org', null);
      when 'sa_overview'       then return dv.a_sa_overview();
      when 'sa_org_save'       then return dv.a_sa_org_save(p);
      when 'sa_org_toggle'     then return dv.a_sa_org_toggle(p);
      when 'sa_admin_save'     then return dv.a_sa_admin_save(p);
      when 'sa_payment_add'    then return dv.a_sa_payment_add(p);
      when 'sa_payment_delete' then return dv.a_sa_payment_delete(p);
      when 'sa_payments'       then return dv.a_sa_payments(p);
      when 'sa_settings'       then return dv.a_sa_settings();
      when 'sa_settings_save'  then return dv.a_sa_settings_save(p);
      else perform dv.fail('Noma’lum amal.');
    end case;
  end if;

  select * into o from dv.orgs where id = u.org_id;
  if not o.active then perform dv.fail('Tashkilot akkaunti to‘xtatilgan. Xizmat ko‘rsatuvchiga murojaat qiling.', 'AUTH'); end if;
  if a = 'me' then return jsonb_build_object('user', dv.user_pub(u), 'org', dv.org_pub(o)); end if;

  -- Obuna tekshiruvi
  if o.paid_until < (now() at time zone o.tz)::date then
    if u.role = 'admin' and a = 'billing' then return dv.a_billing(o); end if;
    if u.role = 'admin' then
      perform dv.fail('Obuna muddati ' || to_char(o.paid_until, 'DD.MM.YYYY') || ' da tugagan. Davom ettirish uchun to‘lovni amalga oshiring.', 'SUB_EXPIRED');
    end if;
    perform dv.fail('Tashkilotingiz obunasi tugagan. Rahbariyatga murojaat qiling.', 'SUB_EXPIRED');
  end if;

  if a = 'submit_attendance' then
    if u.role <> 'employee' then perform dv.fail('Davomatni faqat xodim yuboradi.'); end if;
    return dv.a_submit(u, o, p);
  end if;
  if a = 'my_attendance' then return dv.a_my_attendance(u, o, p); end if;

  if u.role <> 'admin' then perform dv.fail('Bu amal faqat administrator uchun.'); end if;
  case a
    when 'dashboard'         then return dv.a_dashboard(u, o, p);
    when 'users_list'        then return dv.a_users_list(u, o);
    when 'user_save'         then return dv.a_user_save(u, o, p);
    when 'users_import'      then return dv.a_users_import(u, o, p);
    when 'user_reset_device' then return dv.a_user_reset_device(u, o, p);
    when 'user_toggle'       then return dv.a_user_toggle(u, o, p);
    when 'att_list'          then return dv.a_att_list(u, o, p);
    when 'att_decide'        then return dv.a_att_decide(u, o, p);
    when 'org_settings_save' then return dv.a_org_settings_save(u, o, p);
    when 'billing'           then return dv.a_billing(o);
    else perform dv.fail('Noma’lum amal.');
  end case;
  return null;
end $$;

revoke all on function public.api(jsonb) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname='anon') then execute 'grant execute on function public.api(jsonb) to anon'; end if;
  if exists (select 1 from pg_roles where rolname='authenticated') then execute 'grant execute on function public.api(jsonb) to authenticated'; end if;
end $$;

-- ---------------------------------------------------------------- SUPER-ADMIN YARATISH / PAROLINI TIKLASH
-- SQL Editor da bir marta ishga tushiring (login va parolni o'zingiz yozing):
--   select dv.set_superadmin('superadmin', 'KuchliParol123');
-- Parol esdan chiqsa — xuddi shu buyruqni yangi parol bilan qayta ishga tushiring.
create or replace function dv.set_superadmin(un text, pw text) returns text
language plpgsql as $$
begin
  un := dv.valid_username(un); perform dv.valid_password(pw);
  update dv.users set pass_hash = dv.hash_pw(pw), active = true where org_id is null and lower(username) = un;
  if not found then
    insert into dv.users(org_id, role, full_name, username, pass_hash) values (null, 'superadmin', 'Super administrator', un, dv.hash_pw(pw));
  end if;
  delete from dv.sessions where user_id in (select id from dv.users where org_id is null and lower(username) = un);
  return 'Tayyor. Login: ' || un || ' (tashkilot kodi maydonini bo‘sh qoldiring)';
end $$;

revoke all on all functions in schema dv from public;

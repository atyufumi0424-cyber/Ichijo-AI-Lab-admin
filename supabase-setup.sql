-- 初回設定済みの場合、再実行する必要はありません。
-- 管理者権限は atyufumi0424@gmail.com のみに制限されています。
-- 正式なSQLは閲覧サイトから移動したものです。
create table if not exists public.apps(id uuid primary key default gen_random_uuid(),title text not null,category text not null,description text not null,url text default '',code text default '',accent text default 'purple',created_at timestamptz not null default now());
create table if not exists public.posts(id uuid primary key default gen_random_uuid(),title text not null,excerpt text not null,published_on date not null default current_date,created_at timestamptz not null default now());
create table if not exists public.messages(id uuid primary key default gen_random_uuid(),kind text not null check(kind in('依頼','問い合わせ')),name text not null,email text not null,organization text default '',request_type text default '',message text not null,created_at timestamptz not null default now());
alter table public.apps enable row level security;alter table public.posts enable row level security;alter table public.messages enable row level security;
drop policy if exists "apps public read" on public.apps;create policy "apps public read" on public.apps for select using(true);
drop policy if exists "apps admin write" on public.apps;create policy "apps admin write" on public.apps for all to authenticated using((auth.jwt()->>'email')='atyufumi0424@gmail.com') with check((auth.jwt()->>'email')='atyufumi0424@gmail.com');
drop policy if exists "posts public read" on public.posts;create policy "posts public read" on public.posts for select using(true);
drop policy if exists "posts admin write" on public.posts;create policy "posts admin write" on public.posts for all to authenticated using((auth.jwt()->>'email')='atyufumi0424@gmail.com') with check((auth.jwt()->>'email')='atyufumi0424@gmail.com');
drop policy if exists "messages public insert" on public.messages;create policy "messages public insert" on public.messages for insert to anon,authenticated with check(true);
drop policy if exists "messages admin read" on public.messages;create policy "messages admin read" on public.messages for select to authenticated using((auth.jwt()->>'email')='atyufumi0424@gmail.com');
drop policy if exists "messages admin delete" on public.messages;create policy "messages admin delete" on public.messages for delete to authenticated using((auth.jwt()->>'email')='atyufumi0424@gmail.com');
grant usage on schema public to anon,authenticated;grant select on public.apps,public.posts to anon,authenticated;grant insert on public.messages to anon,authenticated;grant insert,update,delete on public.apps,public.posts to authenticated;grant select,delete on public.messages to authenticated;

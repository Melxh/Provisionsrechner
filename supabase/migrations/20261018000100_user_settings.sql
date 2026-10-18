-- Persönliche Einstellungen (aktuelle Vertriebsstufe als Standard für neue Aufträge)
create table public.user_settings (
  user_id      uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  current_tier public.commission_tier not null default 'starter',
  updated_at   timestamptz not null default now()
);

create trigger user_settings_set_updated_at before update on public.user_settings
  for each row execute function public.set_updated_at();

alter table public.user_settings enable row level security;
alter table public.user_settings force row level security;
revoke all on public.user_settings from anon;
revoke all on public.user_settings from public;
grant select, insert, update on public.user_settings to authenticated;

create policy user_settings_select_own on public.user_settings for select to authenticated
  using (user_id = (select auth.uid()));
create policy user_settings_insert_own on public.user_settings for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy user_settings_update_own on public.user_settings for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

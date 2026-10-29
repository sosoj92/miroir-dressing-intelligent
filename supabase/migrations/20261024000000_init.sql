-- Mon Dressing : schéma initial (docs/conception.md §3).
-- À coller dans Supabase > SQL Editor, puis « Run ». Le script peut être relancé sans dommage.
-- Chaque table a un propriétaire (owner) et RLS : seul le compte connecté voit ses lignes.

-- ---------------------------------------------------------------- Tables

create table if not exists public.items (
  id           uuid primary key default gen_random_uuid(),
  owner        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 80),
  category     text not null check (category in ('haut', 'bas', 'robe', 'veste', 'chaussures', 'accessoire')),
  color        text check (color ~ '^#[0-9A-Fa-f]{6}$'),
  warmth       smallint not null default 2 check (warmth between 1 and 3),
  styles       text[] not null default array['decontracte']::text[]
                 check (styles <@ array['decontracte', 'habille', 'sport']::text[]),
  rain_ok      boolean not null default false,
  dirty        boolean not null default false,
  photo_path   text,
  cutout_path  text,
  created_at   timestamptz not null default now()
);
create index if not exists items_owner_idx on public.items (owner);

create table if not exists public.outfit_history (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date        date not null,
  item_ids    uuid[] not null,
  title       text,
  created_at  timestamptz not null default now(),
  unique (owner, date)
);

create table if not exists public.outfit_plans (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date        date not null,
  item_ids    uuid[] not null,
  confirmed   boolean not null default false,
  updated_at  timestamptz not null default now(),
  unique (owner, date)
);

-- item_ids est trié : pièces principales (haut + bas, ou robe) et veste (docs/conception.md §6).
create table if not exists public.refusals (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  item_ids    uuid[] not null,
  created_at  timestamptz not null default now(),
  unique (owner, item_ids)
);

create table if not exists public.profile (
  owner               uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  photo_path          text,
  city                text not null default 'Paris',
  lat                 double precision not null default 48.8566,
  lon                 double precision not null default 2.3522,
  timezone            text not null default 'Europe/Paris',
  key_map             jsonb not null default '{}'::jsonb,
  key_test_requested  boolean not null default false,
  gestures_enabled    boolean not null default true,
  gesture_sensitivity real not null default 1.0 check (gesture_sensitivity between 0.5 and 2.0),
  tryon_cap_eur       numeric(6, 2) not null default 12 check (tryon_cap_eur >= 0),
  evening_hour        smallint not null default 18 check (evening_hour between 12 and 23),
  updated_at          timestamptz not null default now()
);

create table if not exists public.tryon_cache (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  outfit_key  text not null,
  image_path  text not null,
  created_at  timestamptz not null default now(),
  unique (owner, outfit_key)
);

create table if not exists public.spend_ledger (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  service     text not null check (service in ('fashn', 'bria', 'claude')),
  cost_usd    numeric(10, 4) not null check (cost_usd >= 0),
  detail      text,
  created_at  timestamptz not null default now()
);
create index if not exists spend_ledger_owner_created_idx on public.spend_ledger (owner, created_at);

-- ---------------------------------------------------------------- RLS des tables

do $$
declare
  t text;
begin
  foreach t in array array['items', 'outfit_history', 'outfit_plans', 'refusals', 'profile', 'tryon_cache', 'spend_ledger'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists owner_all on public.%I', t);
    execute format(
      'create policy owner_all on public.%I for all to authenticated
         using (owner = (select auth.uid())) with check (owner = (select auth.uid()))', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- Stockage (buckets privés)
-- Chaque fichier est rangé sous <user_id>/… (AGENTS.md).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('items',   'items',   false, 10485760, array['image/jpeg', 'image/png', 'image/webp']),
  ('profile', 'profile', false, 10485760, array['image/jpeg', 'image/png', 'image/webp']),
  ('tryon',   'tryon',   false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists dressing_own_select on storage.objects;
drop policy if exists dressing_own_insert on storage.objects;
drop policy if exists dressing_own_update on storage.objects;
drop policy if exists dressing_own_delete on storage.objects;

create policy dressing_own_select on storage.objects for select to authenticated
  using (bucket_id in ('items', 'profile', 'tryon') and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy dressing_own_insert on storage.objects for insert to authenticated
  with check (bucket_id in ('items', 'profile', 'tryon') and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy dressing_own_update on storage.objects for update to authenticated
  using (bucket_id in ('items', 'profile', 'tryon') and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id in ('items', 'profile', 'tryon') and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy dressing_own_delete on storage.objects for delete to authenticated
  using (bucket_id in ('items', 'profile', 'tryon') and (storage.foldername(name))[1] = (select auth.uid())::text);

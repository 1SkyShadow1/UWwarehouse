create table if not exists public.uw_accounting_data (
  workspace_id text primary key,
  version integer not null default 1,
  revision bigint not null default 0,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.uw_accounting_data enable row level security;

revoke all on table public.uw_accounting_data from anon, authenticated;

create table if not exists public.uw_documents (
  id text primary key,
  workspace_id text not null,
  storage_path text not null unique,
  name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  created_at timestamptz not null default now()
);

alter table public.uw_documents enable row level security;
revoke all on table public.uw_documents from anon, authenticated;

insert into storage.buckets (id, name, public)
values ('uw-documents', 'uw-documents', false)
on conflict (id) do update set public = excluded.public;

drop policy if exists "uw documents service role only" on storage.objects;
create policy "uw documents service role only"
on storage.objects
for all
to service_role
using (bucket_id = 'uw-documents')
with check (bucket_id = 'uw-documents');

create or replace function public.uw_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists uw_accounting_data_updated_at on public.uw_accounting_data;
create trigger uw_accounting_data_updated_at
before update on public.uw_accounting_data
for each row execute function public.uw_touch_updated_at();

-- Durable server-side authentication sessions and encrypted integration secrets.
-- The service role is the only actor that should access these tables.
create table if not exists public.uw_auth_sessions (
  token_hash text primary key,
  workspace_id text not null default 'default',
  email text not null,
  name text not null,
  role text not null,
  csrf_token text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists uw_auth_sessions_workspace_expiry_idx
  on public.uw_auth_sessions (workspace_id, expires_at);

create table if not exists public.uw_secure_secrets (
  workspace_id text not null default 'default',
  secret_name text not null,
  secret_value text not null,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, secret_name)
);

alter table public.uw_auth_sessions enable row level security;
alter table public.uw_secure_secrets enable row level security;
revoke all on public.uw_auth_sessions from anon, authenticated;
revoke all on public.uw_secure_secrets from anon, authenticated;

-- Cleanup is intentionally performed by the server so deployments can use
-- the same service-role path without granting client-side table access.

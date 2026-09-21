-- Workspace-aware lookup support for the private document registry.
-- Existing global primary keys/storage paths remain unchanged for compatibility.
create index if not exists uw_documents_workspace_name_idx
  on public.uw_documents (workspace_id, lower(name));

create index if not exists uw_documents_workspace_storage_idx
  on public.uw_documents (workspace_id, storage_path);

create unique index if not exists uw_documents_workspace_storage_unique
  on public.uw_documents (workspace_id, storage_path);

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'uw_documents'
      and column_name = 'id'
      and data_type = 'uuid'
  ) then
    alter table public.uw_documents
      alter column id type text using id::text;
  end if;
end
$$;

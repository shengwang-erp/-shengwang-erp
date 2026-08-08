-- Project document archive: immutable metadata, private storage and RPC-only projections.
alter table public.projects add column if not exists deleted_at timestamptz;
update public.projects set deleted_at = coalesce(deleted_at, updated_at, now()) where status = 'deleted';
create or replace function private.project_deleted_at_guard() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
  if old.deleted_at is not null and new.deleted_at is distinct from old.deleted_at then raise exception 'deleted_at is immutable'; end if;
  if new.status = 'deleted' and new.deleted_at is null then new.deleted_at := statement_timestamp(); end if;
  if new.status <> 'deleted' and new.deleted_at is not null then raise exception 'deleted project status is immutable'; end if;
  return new;
end $$;
drop trigger if exists project_deleted_at_guard on public.projects;
create trigger project_deleted_at_guard before update on public.projects for each row execute function private.project_deleted_at_guard();

create table if not exists public.project_document_logicals (
 logical_document_id uuid primary key default gen_random_uuid(), project_id text not null references public.projects(record_key) on delete restrict,
 document_kind text not null check (document_kind in ('project_contract','rendering','contract_change_document')),
 last_reserved_version integer not null default 0 check(last_reserved_version >= 0),
 created_by_employee_id uuid, created_at timestamptz not null default statement_timestamp(),
 unique(project_id,logical_document_id)
);
create table if not exists public.project_documents (
 document_id uuid primary key default gen_random_uuid(), project_id text not null references public.projects(record_key) on delete restrict,
 document_kind text not null check (document_kind in ('project_contract','rendering','contract_change_document')),
 logical_document_id uuid not null references public.project_document_logicals(logical_document_id) on delete restrict,
 version integer not null check(version>0), bucket_id text not null default 'erp-project-documents' check(bucket_id='erp-project-documents'),
 object_path text not null unique, original_file_name text not null check(length(original_file_name)<=255 and original_file_name !~ '[[:cntrl:]]'), file_extension text not null,
 declared_content_type text not null check(length(btrim(declared_content_type))>0), verified_content_type text, expected_size_bytes bigint not null check(expected_size_bytes between 1 and 52428800),
 verified_size_bytes bigint, expected_checksum_sha256 text not null check(expected_checksum_sha256 ~ '^[0-9a-f]{64}$'), verified_checksum_sha256 text,
 status text not null check(status in ('pending','queued','finalizing','active','void','failed','cleanup_pending')),
 processing_token uuid, processing_lease_until timestamptz, upload_ticket_issuable_until timestamptz, cleanup_not_before timestamptz,
 created_by_employee_id uuid, created_by_employee_number text, created_by_employee_name text, created_at timestamptz not null default statement_timestamp(), completed_at timestamptz,
 voided_by_employee_id uuid, voided_by_employee_number text, voided_at timestamptz, void_reason text, failure_code text,
 unique(logical_document_id,version), check(object_path = project_id || '/' || document_id::text || '/' || version::text),
 check(void_reason is null or (length(btrim(void_reason)) between 1 and 500))
);
create table if not exists public.project_document_events (
 event_id bigint generated always as identity primary key, document_id uuid references public.project_documents(document_id) on delete restrict,
 project_id text not null, event_type text not null, actor_id uuid, actor_employee_number text, created_at timestamptz not null default statement_timestamp(), details jsonb not null default '{}'
);
create or replace function private.reject_project_document_logical_mutation() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if tg_op='DELETE' then raise exception 'project document logical rows are immutable'; end if;
 if new.logical_document_id<>old.logical_document_id or new.project_id<>old.project_id or new.document_kind<>old.document_kind or new.created_at<>old.created_at or new.created_by_employee_id is distinct from old.created_by_employee_id then raise exception 'project document logical identity is immutable'; end if;
 return new;
end $$;
drop trigger if exists project_document_logical_immutable on public.project_document_logicals;
create trigger project_document_logical_immutable before update or delete on public.project_document_logicals for each row execute function private.reject_project_document_logical_mutation();

create or replace function private.reject_project_document_mutation() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if tg_op='DELETE' then raise exception 'project document rows are immutable'; end if;
 if new.document_id<>old.document_id or new.project_id<>old.project_id or new.document_kind<>old.document_kind or new.logical_document_id<>old.logical_document_id or new.version<>old.version or new.object_path<>old.object_path or new.original_file_name<>old.original_file_name or new.file_extension<>old.file_extension or new.declared_content_type<>old.declared_content_type or new.created_at<>old.created_at then raise exception 'project document identity is immutable'; end if;
 if old.status in ('active','void') and row(new.*) is distinct from row(old.*) then raise exception 'active and void versions are immutable'; end if;
 return new;
end $$;
drop trigger if exists project_document_immutable on public.project_documents;
create trigger project_document_immutable before update or delete on public.project_documents for each row execute function private.reject_project_document_mutation();
create or replace function private.reject_document_event_mutation() returns trigger language plpgsql set search_path=pg_catalog,public as $$ begin raise exception 'document events are append only'; end $$;
drop trigger if exists project_document_event_immutable on public.project_document_events;
create trigger project_document_event_immutable before update or delete on public.project_document_events for each row execute function private.reject_document_event_mutation();

create or replace function public.can_current_employee_view_project_document_kind(p_kind text) returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
 if not public.is_current_employee_active() or not public.has_current_permission('module.projects.view') then return false; end if;
 if p_kind='rendering' then return true; end if;
 return public.can_current_employee_view_project_financials();
end $$;
create or replace function public.can_current_employee_update_project_document_kind(p_kind text) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$ select public.can_current_employee_view_project_document_kind(p_kind) and public.has_current_permission('module.projects.update') $$;

create or replace function public.list_project_documents_secure(p_project_id text,p_cursor text default null,p_limit integer default 50) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare lim integer := least(greatest(coalesce(p_limit,50),1),100); result jsonb;
begin
 if not exists(select 1 from public.projects p where p.record_key=p_project_id and p.status<>'deleted') then raise exception 'project not found'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('documentId',d.document_id,'projectId',d.project_id,'documentKind',d.document_kind,'logicalDocumentId',d.logical_document_id,'version',d.version,'originalFileName',d.original_file_name,'fileExtension',d.file_extension,'declaredContentType',d.declared_content_type,'verifiedContentType',d.verified_content_type,'expectedSizeBytes',d.expected_size_bytes,'verifiedSizeBytes',d.verified_size_bytes,'status',d.status,'createdAt',d.created_at,'completedAt',d.completed_at) order by d.created_at desc,d.document_id), '[]') into result from public.project_documents d where d.project_id=p_project_id and d.status not in ('failed','cleanup_pending') and public.can_current_employee_view_project_document_kind(d.document_kind);
 return jsonb_build_object('items',result,'nextCursor',null);
end $$;
create or replace function public.list_project_document_history_secure(p_logical_document_id uuid,p_cursor text default null,p_limit integer default 50) returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$ select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('documentId',d.document_id,'version',d.version,'status',d.status,'originalFileName',d.original_file_name,'createdAt',d.created_at) order by d.version desc) from public.project_documents d where d.logical_document_id=p_logical_document_id and public.can_current_employee_view_project_document_kind(d.document_kind)),'[]'),'nextCursor',null) $$;
create or replace function public.list_my_incomplete_project_documents_secure(p_project_id text,p_cursor text default null,p_limit integer default 50) returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$ select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('documentId',d.document_id,'status',d.status,'version',d.version,'createdAt',d.created_at) order by d.created_at desc) from public.project_documents d where d.project_id=p_project_id and d.status in ('pending','queued','finalizing')),'[]'),'nextCursor',null) $$;
create or replace function public.list_deleted_project_archive_secure(p_cursor text default null,p_limit integer default 50) returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$ select jsonb_build_object('items',case when exists(select 1 from public.employee_profiles e where e.auth_user_id=auth.uid() and e.employee_number='SW-000' and e.deleted_at is null) then coalesce((select jsonb_agg(to_jsonb(p)) from public.projects p where p.status='deleted'),'[]') else '[]'::jsonb end,'nextCursor',null) $$;
create or replace function public.list_deleted_project_documents_secure(p_project_id text,p_cursor text default null,p_limit integer default 50) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
 if not exists(select 1 from public.projects p where p.record_key=p_project_id and p.status='deleted') then raise exception 'project not found'; end if;
 if not exists(select 1 from public.employee_profiles e where e.auth_user_id=auth.uid() and e.employee_number='SW-000' and e.deleted_at is null) then raise exception 'project not found'; end if;
 return (select jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object('documentId',d.document_id,'projectId',d.project_id,'documentKind',d.document_kind,'logicalDocumentId',d.logical_document_id,'version',d.version,'originalFileName',d.original_file_name,'status',d.status,'createdAt',d.created_at) order by d.created_at desc),'[]'),'nextCursor',null) from public.project_documents d where d.project_id=p_project_id);
end $$;
create or replace function public.abandon_project_document_upload_secure(p_document_id uuid,p_reason text default 'abandoned') returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$ begin update public.project_documents set status='void',voided_at=statement_timestamp(),void_reason=left(btrim(coalesce(p_reason,'abandoned')),500) where document_id=p_document_id and status in ('pending','queued','finalizing') and public.can_current_employee_update_project_document_kind(document_kind); if not found then raise exception 'document not found'; end if; return jsonb_build_object('documentId',p_document_id,'status','void'); end $$;
create or replace function public.void_project_document_secure(p_document_id uuid,p_reason text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$ begin if p_reason is null or length(btrim(p_reason)) not between 1 and 500 then raise exception 'invalid void reason'; end if; update public.project_documents set status='void',voided_at=statement_timestamp(),void_reason=btrim(p_reason) where document_id=p_document_id and status='active' and public.can_current_employee_update_project_document_kind(document_kind); if not found then raise exception 'document not found'; end if; return jsonb_build_object('documentId',p_document_id,'status','void'); end $$;

revoke all on public.project_document_logicals,public.project_documents,public.project_document_events from anon,authenticated;
revoke all on function public.list_project_documents_secure(text,text,integer),public.list_project_document_history_secure(uuid,text,integer),public.list_my_incomplete_project_documents_secure(text,text,integer),public.list_deleted_project_archive_secure(text,integer),public.list_deleted_project_documents_secure(text,text,integer),public.abandon_project_document_upload_secure(uuid,text),public.void_project_document_secure(uuid,text) from public,anon,authenticated;
grant execute on function public.list_project_documents_secure(text,text,integer),public.list_project_document_history_secure(uuid,text,integer),public.list_my_incomplete_project_documents_secure(text,text,integer),public.list_deleted_project_archive_secure(text,integer),public.list_deleted_project_documents_secure(text,text,integer),public.abandon_project_document_upload_secure(uuid,text),public.void_project_document_secure(uuid,text) to authenticated,service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('erp-project-documents','erp-project-documents',false,52428800,array['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','image/jpeg','image/png','image/webp','image/heic','image/heif']) on conflict(id) do update set public=false,file_size_limit=52428800,allowed_mime_types=excluded.allowed_mime_types;

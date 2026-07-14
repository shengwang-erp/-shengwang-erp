-- 生旺 ERP：合同收入链增量表结构
-- 仅用于已有 Supabase 数据库。可重复执行，不删除现有表或业务数据。

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.create_contract_revenue_record_table(target_table text)
returns void
language plpgsql
as $$
declare
  existing_policy text;
begin
  execute format(
    'create table if not exists public.%I (
      id uuid primary key default gen_random_uuid(),
      record_key text not null unique,
      payload jsonb not null default ''{}''::jsonb,
      attachments jsonb not null default ''[]''::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      created_by_employee_id text not null default '''',
      created_by_employee_name text not null default '''',
      updated_by_employee_id text not null default '''',
      updated_by_employee_name text not null default '''',
      status text not null default ''active'' check (status in (''active'', ''deleted'', ''void''))
    )',
    target_table
  );

  execute format('alter table public.%I enable row level security', target_table);
  execute format(
    'revoke all on table public.%I from public, anon, authenticated',
    target_table
  );
  for existing_policy in
    select policies.policyname
    from pg_catalog.pg_policies as policies
    where policies.schemaname = 'public'
      and policies.tablename = target_table
  loop
    execute format('drop policy if exists %I on public.%I', existing_policy, target_table);
  end loop;

  -- Intentionally create no permissive policy here. Standalone execution is
  -- fail-closed; the employee-auth migration owns authenticated business RLS.

  execute format(
    'drop trigger if exists set_%s_updated_at on public.%I',
    target_table,
    target_table
  );
  execute format(
    'create trigger set_%s_updated_at before update on public.%I
     for each row execute function public.set_updated_at()',
    target_table,
    target_table
  );
end;
$$;

select public.create_contract_revenue_record_table('project_contract_changes');
select public.create_contract_revenue_record_table('project_payment_plans');
select public.create_contract_revenue_record_table('project_receipts');

drop function if exists public.create_contract_revenue_record_table(text);
revoke all on function public.set_updated_at() from public, anon, authenticated;

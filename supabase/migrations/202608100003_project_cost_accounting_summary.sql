-- Provide an uncapped, aggregate-only accounting view of the project-cost ledger.

create function public.summarize_project_cost_ledger_secure(
  p_filters jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  response jsonb;
begin
  if not public.is_current_employee_active() then
    raise exception using
      errcode = '42501', message = 'active employee required',
      hint = 'PROJECT_COST_LEDGER_ACCESS_DENIED';
  end if;
  if not public.has_current_permission('module.project_costs.view') then
    raise exception using
      errcode = '42501',
      message = 'project cost ledger view permission required',
      hint = 'PROJECT_COST_LEDGER_ACCESS_DENIED';
  end if;
  if p_filters is null
    or pg_catalog.jsonb_typeof(p_filters) <> 'object'
    or exists (select 1 from pg_catalog.jsonb_object_keys(p_filters))
  then
    raise exception using
      errcode = '22023', message = 'invalid project cost accounting filters',
      hint = 'PROJECT_COST_LEDGER_INPUT_INVALID';
  end if;

  with facts as materialized (
    select * from private.private_project_cost_source_facts()
  ), latest_adjustment as (
    select distinct on (event.source_key)
      event.source_key, event.sequence_no, event.amount_after
    from public.project_cost_adjustment_events event
    order by event.source_key, event.sequence_no desc
  ), latest_allocation as (
    select distinct on (event.source_key)
      event.source_key, event.sequence_no, event.amount_snapshot,
      event.allocations
    from public.project_cost_allocation_events event
    order by event.source_key, event.sequence_no desc
  ), effective as (
    select
      fact.*,
      coalesce(adjustment.amount_after, fact.original_amount)::numeric(18,4)
        effective_amount,
      allocation.sequence_no allocation_sequence_no,
      allocation.amount_snapshot,
      allocation.allocations
    from facts fact
    left join latest_adjustment adjustment using (source_key)
    left join latest_allocation allocation using (source_key)
  ), supplied_allocation_items as (
    select
      source.source_key,
      item.ordinality,
      case
        when pg_catalog.jsonb_typeof(item.value) = 'object'
          and (select count(*) from pg_catalog.jsonb_object_keys(item.value)) = 2
          and item.value ? 'projectId'
          and item.value ? 'amount'
          and pg_catalog.jsonb_typeof(item.value->'projectId') = 'string'
          and item.value->>'projectId' = pg_catalog.btrim(item.value->>'projectId')
          and pg_catalog.char_length(item.value->>'projectId') between 1 and 500
          and item.value->>'projectId' not in (
            '__proto__', 'constructor', 'prototype'
          )
          and private.project_cost_safe_amount(item.value->'amount') is not null
        then item.value->>'projectId'
        else null
      end allocation_project_id,
      private.project_cost_safe_amount(item.value->'amount') allocation_amount
    from effective source
    cross join lateral pg_catalog.jsonb_array_elements(
      source.allocations
    ) with ordinality item(value, ordinality)
    where source.allocation_sequence_no is not null
      and pg_catalog.jsonb_typeof(source.allocations) = 'array'
  ), allocation_validity as (
    select source.source_key,
      source.source_module is not null
        and source.source_document_type is not null
        and source.source_document_id is not null
        and source.project_id is not null
        and source.category is not null
        and (
          source.allocation_sequence_no is null or (
            source.amount_snapshot = source.effective_amount
            and pg_catalog.jsonb_typeof(source.allocations) = 'array'
            and pg_catalog.jsonb_array_length(source.allocations)
              between 1 and 100
            and pg_catalog.count(item.ordinality)
              = pg_catalog.jsonb_array_length(source.allocations)
            and pg_catalog.count(item.allocation_project_id)
              = pg_catalog.jsonb_array_length(source.allocations)
            and pg_catalog.count(distinct item.allocation_project_id)
              = pg_catalog.jsonb_array_length(source.allocations)
            and coalesce(pg_catalog.sum(item.allocation_amount), 0)
              = source.effective_amount
          )
        ) valid
    from effective source
    left join supplied_allocation_items item using (source_key)
    group by source.source_key, source.allocation_sequence_no,
      source.amount_snapshot, source.effective_amount, source.allocations,
      source.source_module, source.source_document_type,
      source.source_document_id, source.project_id, source.category
  ), final_rows as materialized (
    select
      source.project_id,
      source.cost_date,
      source.category,
      source.effective_amount amount
    from effective source
    join allocation_validity validity using (source_key)
    where source.allocation_sequence_no is null and validity.valid
    union all
    select
      item.allocation_project_id,
      source.cost_date,
      source.category,
      item.allocation_amount
    from supplied_allocation_items item
    join effective source using (source_key)
    join allocation_validity validity using (source_key)
    where validity.valid
  ), summary as (
    select private.project_cost_checked_summary(
      coalesce(pg_catalog.sum(amount), 0)
    ) total_amount
    from final_rows
  ), monthly_totals as (
    select coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'month', grouped.month_value,
        'amount', grouped.amount
      ) order by grouped.month_value
    ), '[]'::jsonb) value
    from (
      select
        pg_catalog.to_char(
          pg_catalog.date_trunc('month', cost_date), 'YYYY-MM'
        ) month_value,
        private.project_cost_checked_summary(
          pg_catalog.sum(amount)
        ) amount
      from final_rows
      group by pg_catalog.date_trunc('month', cost_date)
    ) grouped
  ), project_totals as (
    select coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'projectId', grouped.project_id,
        'amount', grouped.amount
      ) order by grouped.project_id
    ), '[]'::jsonb) value
    from (
      select project_id,
        private.project_cost_checked_summary(
          pg_catalog.sum(amount)
        ) amount
      from final_rows
      group by project_id
    ) grouped
  ), category_totals as (
    select coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'category', grouped.category,
        'amount', grouped.amount
      ) order by grouped.category_order, grouped.category
    ), '[]'::jsonb) value
    from (
      select category,
        private.project_cost_checked_summary(
          pg_catalog.sum(amount)
        ) amount,
        case category
          when '人工费' then 1 when '材料费' then 2 when '车辆费' then 3
          when '工具费' then 4 when '外包费' then 5 when '运输费' then 6
          when '经营费用' then 7 when '其他费用' then 8 else 9
        end category_order
      from final_rows
      group by category
    ) grouped
  ), project_month_category_totals as (
    select coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'projectId', grouped.project_id,
        'month', grouped.month_value,
        'category', grouped.category,
        'amount', grouped.amount
      ) order by grouped.project_id, grouped.month_value,
        grouped.category_order, grouped.category
    ), '[]'::jsonb) value
    from (
      select project_id,
        pg_catalog.to_char(
          pg_catalog.date_trunc('month', cost_date), 'YYYY-MM'
        ) month_value,
        category,
        private.project_cost_checked_summary(
          pg_catalog.sum(amount)
        ) amount,
        case category
          when '人工费' then 1 when '材料费' then 2 when '车辆费' then 3
          when '工具费' then 4 when '外包费' then 5 when '运输费' then 6
          when '经营费用' then 7 when '其他费用' then 8 else 9
        end category_order
      from final_rows
      group by project_id, pg_catalog.date_trunc('month', cost_date), category
    ) grouped
  ), incomplete as (
    select coalesce(pg_catalog.jsonb_agg(
      validity.source_key order by validity.source_key
    ), '[]'::jsonb) value
    from allocation_validity validity
    where not validity.valid
  )
  select pg_catalog.jsonb_build_object(
    'status', 'ready',
    'generatedAt', pg_catalog.statement_timestamp(),
    'totalAmount', summary.total_amount,
    'monthlyTotals', monthly_totals.value,
    'projectTotals', project_totals.value,
    'categoryTotals', category_totals.value,
    'projectMonthCategoryTotals', project_month_category_totals.value,
    'incompleteSources', incomplete.value
  )
  into response
  from summary
  cross join monthly_totals
  cross join project_totals
  cross join category_totals
  cross join project_month_category_totals
  cross join incomplete;

  return response;
end;
$$;

revoke all on function public.summarize_project_cost_ledger_secure(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.summarize_project_cost_ledger_secure(jsonb)
  to authenticated, service_role;

-- 中部枠のルール変更: 「30分の完全先着 -> その後は中部優先」をやめ、
-- 「エントリー開始から24時間は中部地方を優先」に置き換える。
--
-- 並び順:
--   1. 24時間以内にエントリーした中部地方の参加者(エントリー順)
--   2. 24時間以内にエントリーした中部地方以外の参加者(エントリー順)
--   3. 24時間より後にエントリーした参加者(中部かどうかを問わずエントリー順)
--
-- 変更点は ranked CTE の並び順のみ。定員判定・キャンセル待ち繰り上げ・
-- 繰り上げ通知の扱いは 202607080003 のまま維持する。
-- クライアント側の表示順(js/entry_list.js の calcPriority)も同じ規則に揃えること。

create or replace function public.recompute_entry_statuses(
  p_project_id text,
  p_allow_waitlist_promotion boolean default true
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project public.projects%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext(p_project_id));

  select *
    into v_project
    from public.projects
    where projects.id = p_project_id;

  if not found then
    raise exception 'Project not found';
  end if;

  with ranked as (
    select
      e.id,
      e.status as old_status,
      e.checked_in,
      row_number() over (
        order by
          -- 新ルール(中部枠): エントリー開始から24時間は中部地方を優先する。
          --   0 = 24時間以内かつ中部
          --   1 = 24時間以内かつ中部以外
          --   2 = 24時間経過後(中部かどうかを問わない)
          -- 各区分の内部はエントリー順(created_at, entry_number)。
          -- period_start 未設定の大会は優先枠を適用せず全員先着順にする。
          case
            when v_project.period_start is null then 0
            when e.created_at <= v_project.period_start + interval '24 hours'
              then case when e.is_chubu then 0 else 1 end
            else 2
          end,
          e.created_at asc,
          e.entry_number asc
      ) as priority
    from public.entries e
    where e.project_id = p_project_id
      and e.status <> 'canceled'
  ),
  desired as (
    select
      id,
      old_status,
      checked_in,
      case
        when checked_in then old_status
        when v_project.max_entries <= 0 or priority <= v_project.max_entries then
          case when old_status = 'late' then 'late' else 'registered' end
        else 'waitlist'
      end as new_status
    from ranked
  )
  update public.entries e
    set
      status = case
        when desired.old_status = 'waitlist'
          and desired.new_status in ('registered', 'late')
          and not p_allow_waitlist_promotion
          then 'waitlist'
        else desired.new_status
      end,
      waitlist_promoted_at = case
        when desired.old_status = 'waitlist'
          and desired.new_status in ('registered', 'late')
          and p_allow_waitlist_promotion
          then coalesce(e.waitlist_promoted_at, now())
        when desired.new_status = 'waitlist'
          then null
        else e.waitlist_promoted_at
      end,
      waitlist_promotion_notice = case
        when desired.old_status = 'waitlist'
          and desired.new_status in ('registered', 'late')
          and p_allow_waitlist_promotion
          then coalesce(e.waitlist_promotion_notice, 'pending')
        when desired.new_status = 'waitlist'
          then null
        else e.waitlist_promotion_notice
      end
  from desired
  where e.id = desired.id
    and (
      e.status is distinct from case
        when desired.old_status = 'waitlist'
          and desired.new_status in ('registered', 'late')
          and not p_allow_waitlist_promotion
          then 'waitlist'
        else desired.new_status
      end
      or (
        desired.old_status = 'waitlist'
        and desired.new_status in ('registered', 'late')
        and p_allow_waitlist_promotion
        and e.waitlist_promotion_notice is null
      )
      or (
        desired.new_status = 'waitlist'
        and (e.waitlist_promoted_at is not null or e.waitlist_promotion_notice is not null)
      )
    );
end;
$$;

revoke all on function public.recompute_entry_statuses(text, boolean) from public, anon, authenticated;
grant execute on function public.recompute_entry_statuses(text, boolean) to service_role;

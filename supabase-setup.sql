-- Run this entire file once in the Supabase SQL Editor.
-- Safe to rerun: existing club data and approved editors are preserved.
begin;

create schema if not exists club_private;
revoke all on schema club_private from public, anon, authenticated;

create table if not exists public.club_editors (
    user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.club_editors enable row level security;
revoke all on public.club_editors from public, anon, authenticated;
grant select on public.club_editors to authenticated;
drop policy if exists "Editors can check their own access" on public.club_editors;
create policy "Editors can check their own access" on public.club_editors
    for select to authenticated using (user_id = (select auth.uid()));

create table if not exists public.club_state (
    id integer primary key check (id = 1),
    data jsonb not null,
    revision integer not null default 0 check (revision >= 0),
    updated_at timestamptz not null default now()
);
alter table public.club_state enable row level security;
revoke all on public.club_state from public, anon, authenticated;
grant select on public.club_state to anon, authenticated;
drop policy if exists "Everyone can view club data" on public.club_state;
create policy "Everyone can view club data" on public.club_state
    for select to anon, authenticated using (true);

insert into public.club_state (id, data)
values (1, '{"picks":[],"portfolio":{"holdings":[],"history":[]}}'::jsonb)
on conflict (id) do nothing;

create or replace function club_private.valid_date(value text)
returns boolean language plpgsql stable set search_path = '' as $$
begin
    return value ~ '^\d{4}-\d{2}-\d{2}$'
        and to_char(value::date, 'YYYY-MM-DD') = value
        and value::date <= (now() at time zone 'UTC')::date + 1;
exception when others then return false;
end;
$$;

create or replace function club_private.valid_data(payload jsonb)
returns boolean language plpgsql stable set search_path = '' as $$
declare
    item jsonb;
    total_cost numeric := 0;
begin
    if payload is null or jsonb_typeof(payload) <> 'object'
        or not (payload ?& array['picks', 'portfolio'])
        or jsonb_typeof(payload->'picks') <> 'array'
        or jsonb_typeof(payload->'portfolio') <> 'object'
        or not ((payload->'portfolio') ?& array['holdings', 'history'])
        or jsonb_typeof(payload#>'{portfolio,holdings}') <> 'array'
        or jsonb_typeof(payload#>'{portfolio,history}') <> 'array'
        or jsonb_array_length(payload->'picks') > 500
        or jsonb_array_length(payload#>'{portfolio,holdings}') > 500
        or jsonb_array_length(payload#>'{portfolio,history}') > 10000 then return false;
    end if;

    for item in select value from jsonb_array_elements(payload->'picks') loop
        if jsonb_typeof(item) <> 'object'
            or not (item ?& array['symbol', 'holder', 'pickedDate', 'startingPrice'])
            or jsonb_typeof(item->'symbol') <> 'string' or item->>'symbol' !~ '^[A-Z0-9.^:/-]{1,30}$'
            or jsonb_typeof(item->'holder') <> 'string' or length(trim(item->>'holder')) = 0 or length(item->>'holder') > 80
            or (item->'pickedDate' <> 'null'::jsonb and not club_private.valid_date(item->>'pickedDate'))
            or (item->'startingPrice' <> 'null'::jsonb and
                (jsonb_typeof(item->'startingPrice') <> 'number' or (item->>'startingPrice')::numeric <= 0)) then return false;
        end if;
    end loop;

    for item in select value from jsonb_array_elements(payload#>'{portfolio,holdings}') loop
        if jsonb_typeof(item) <> 'object'
            or not (item ?& array['id', 'name', 'asset', 'cost', 'value', 'style', 'cap', 'sector'])
            or jsonb_typeof(item->'id') <> 'string' or length(item->>'id') = 0
            or jsonb_typeof(item->'name') <> 'string' or length(trim(item->>'name')) = 0 or length(item->>'name') > 80
            or item->>'asset' not in ('Stocks', 'Bonds') or jsonb_typeof(item->'asset') <> 'string'
            or jsonb_typeof(item->'cost') <> 'number' or (item->>'cost')::numeric <= 0
            or jsonb_typeof(item->'value') <> 'number' or (item->>'value')::numeric < 0 or (item->>'value')::numeric > 1e12
            or jsonb_typeof(item->'style') <> 'string' or item->>'style' not in ('Unclassified', 'Value', 'Growth', 'Blend')
            or jsonb_typeof(item->'cap') <> 'string' or item->>'cap' not in ('Unclassified', 'Mega cap', 'Large cap', 'Mid cap', 'Small cap', 'Micro cap')
            or jsonb_typeof(item->'sector') <> 'string' or item->>'sector' not in (
                'Unclassified', 'Technology', 'Healthcare', 'Financials', 'Consumer discretionary',
                'Consumer staples', 'Industrials', 'Energy', 'Utilities', 'Real estate', 'Materials',
                'Communication services', 'Diversified') then return false;
        end if;
        total_cost := total_cost + (item->>'cost')::numeric;
    end loop;
    if total_cost > 10000.001 then return false; end if;
    if (select count(*) <> count(distinct value->>'id') from jsonb_array_elements(payload#>'{portfolio,holdings}')) then return false; end if;

    for item in select value from jsonb_array_elements(payload#>'{portfolio,history}') loop
        if jsonb_typeof(item) <> 'object' or not (item ?& array['date', 'value'])
            or jsonb_typeof(item->'date') <> 'string' or not club_private.valid_date(item->>'date')
            or jsonb_typeof(item->'value') <> 'number' or (item->>'value')::numeric < 0 or (item->>'value')::numeric > 1e12 then return false;
        end if;
    end loop;
    if (select count(*) <> count(distinct value->>'date') from jsonb_array_elements(payload#>'{portfolio,history}')) then return false; end if;
    return true;
exception when others then return false;
end;
$$;
revoke all on function club_private.valid_date(text) from public, anon, authenticated;
revoke all on function club_private.valid_data(jsonb) from public, anon, authenticated;

-- Only this function may write from the website. It checks the authenticated
-- user against an allowlist that website users cannot modify themselves.
create or replace function public.save_club_state(next_data jsonb, expected_revision integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare new_revision integer;
begin
    if (select auth.uid()) is null or not exists (
        select 1 from public.club_editors where user_id = (select auth.uid())
    ) then raise exception 'Club editor access required' using errcode = '42501'; end if;
    if octet_length(next_data::text) > 2000000 or not club_private.valid_data(next_data) then
        raise exception 'Invalid club data' using errcode = '22023';
    end if;
    update public.club_state set data = next_data, revision = revision + 1, updated_at = now()
    where id = 1 and revision = expected_revision returning revision into new_revision;
    if new_revision is null then
        raise exception 'Another editor saved newer data; reload before saving' using errcode = '40001';
    end if;
    return new_revision;
end;
$$;
revoke all on function public.save_club_state(jsonb, integer) from public, anon, authenticated;
grant execute on function public.save_club_state(jsonb, integer) to authenticated;
notify pgrst, 'reload schema';
commit;

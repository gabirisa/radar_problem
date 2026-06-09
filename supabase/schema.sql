create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'submission_status') then
    create type public.submission_status as enum ('pending', 'approved', 'spam', 'duplicate');
  else
    alter type public.submission_status add value if not exists 'pending';
    alter type public.submission_status add value if not exists 'approved';
    alter type public.submission_status add value if not exists 'spam';
    alter type public.submission_status add value if not exists 'duplicate';
  end if;
end
$$;

create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  profession text not null check (char_length(trim(profession)) between 2 and 120),
  email text,
  description text not null check (char_length(trim(description)) between 20 and 4000),
  tools text,
  extra text,
  source text not null default 'landing',
  ip_hash text,
  user_agent text,
  status public.submission_status not null default 'pending',
  duplicate_of uuid references public.submissions(id),
  metadata jsonb not null default '{}'::jsonb
);

alter table public.submissions
  add column if not exists email text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'submissions_email_format_check'
      and conrelid = 'public.submissions'::regclass
  ) then
    alter table public.submissions
      add constraint submissions_email_format_check
      check (
        email is null
        or (
          char_length(email) <= 254
          and email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        )
      );
  end if;
end
$$;

alter table public.submissions
  alter column status set default 'pending'::public.submission_status;

create table if not exists public.landing_stats (
  id integer primary key default 1 check (id = 1),
  problem_count bigint not null default 0,
  profession_count bigint not null default 0,
  updated_at timestamptz not null default now()
);

insert into public.landing_stats (id)
values (1)
on conflict (id) do nothing;

create index if not exists submissions_created_at_idx on public.submissions (created_at desc);
create index if not exists submissions_profession_idx on public.submissions (lower(profession));
create index if not exists submissions_ip_hash_idx on public.submissions (ip_hash);
create index if not exists submissions_status_idx on public.submissions (status);
create index if not exists submissions_description_trgm_idx
  on public.submissions using gin (description gin_trgm_ops);

alter table public.admins enable row level security;
alter table public.submissions enable row level security;
alter table public.landing_stats enable row level security;

drop policy if exists "Admins can read themselves" on public.admins;
create policy "Admins can read themselves"
  on public.admins
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Admins can read submissions" on public.submissions;
create policy "Admins can read submissions"
  on public.submissions
  for select
  to authenticated
  using (exists (select 1 from public.admins where admins.user_id = auth.uid()));

drop policy if exists "Admins can update submissions" on public.submissions;
create policy "Admins can update submissions"
  on public.submissions
  for update
  to authenticated
  using (exists (select 1 from public.admins where admins.user_id = auth.uid()))
  with check (exists (select 1 from public.admins where admins.user_id = auth.uid()));

drop policy if exists "Anyone can read landing stats" on public.landing_stats;
create policy "Anyone can read landing stats"
  on public.landing_stats
  for select
  to anon, authenticated
  using (id = 1);

create or replace function public.recalculate_landing_stats()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.landing_stats
  set
    problem_count = (
      select count(*)
      from public.submissions
      where status in ('pending', 'approved')
    ),
    profession_count = (
      select count(distinct lower(trim(profession)))
      from public.submissions
      where status in ('pending', 'approved')
    ),
    updated_at = now()
  where id = 1;
end;
$$;

create or replace function public.refresh_landing_stats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recalculate_landing_stats();
  return coalesce(new, old);
end;
$$;

drop trigger if exists submissions_refresh_landing_stats on public.submissions;
create trigger submissions_refresh_landing_stats
after insert or update of status, profession or delete on public.submissions
for each row execute function public.refresh_landing_stats();

create or replace function public.get_landing_stats()
returns table(problem_count bigint, profession_count bigint)
language sql
security definer
set search_path = public
as $$
  select landing_stats.problem_count, landing_stats.profession_count
  from public.landing_stats
  where id = 1;
$$;

create or replace function public.find_similar_submission(
  input_description text,
  since timestamptz,
  threshold real default 0.85
)
returns table(id uuid, score real)
language sql
security definer
set search_path = public
as $$
  select submissions.id, similarity(submissions.description, input_description)::real as score
  from public.submissions
  where submissions.created_at >= since
    and submissions.status in ('pending', 'approved')
    and similarity(submissions.description, input_description) >= threshold
  order by score desc
  limit 1;
$$;

select public.recalculate_landing_stats();

revoke all on function public.get_landing_stats() from public;
grant execute on function public.get_landing_stats() to anon, authenticated;

revoke all on function public.find_similar_submission(text, timestamptz, real) from public;
grant execute on function public.find_similar_submission(text, timestamptz, real) to service_role;

grant usage on schema public to anon, authenticated;
grant select on public.landing_stats to anon, authenticated;
grant select, update on public.submissions to authenticated;
grant select on public.admins to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'landing_stats'
  ) then
    alter publication supabase_realtime add table public.landing_stats;
  end if;
end
$$;

-- After creating your admin user in Supabase Auth, run:
-- insert into public.admins (user_id)
-- select id from auth.users where email = 'tu-email@dominio.com';

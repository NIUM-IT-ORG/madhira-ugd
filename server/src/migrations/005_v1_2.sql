-- v1.2: labour by zone with 48-hour editing, supervisors (AEE), and starting accounts added by later releases.
-- Nothing is removed: the old ward-based labour_logs table stays as it was; its figures are copied, added up
-- per zone and day, into labour_entries (the original wards are kept in legacy_wards).

alter table users add column supervisor boolean not null default false;

-- The AEE corrects field staff entries; existing AEE accounts become supervisors.
update users set supervisor = true
 where role = 'editor' and (designation ilike '%assistant executive engineer%' or designation ilike 'aee%' or email like 'aee@%');

create table labour_entries (
  id bigserial primary key,
  log_date date not null,
  zone int not null check (zone between 1 and 4),
  labourers int not null check (labourers >= 0),
  machines int not null default 0 check (machines >= 0),
  note text,
  user_id uuid references users(id),
  created_at timestamptz not null default now(),
  updated_by uuid references users(id),
  updated_at timestamptz,
  legacy_wards int[],
  unique (log_date, zone)
);

create table labour_entry_events (
  id bigserial primary key,
  entry_id bigint not null references labour_entries(id) on delete cascade,
  user_id uuid references users(id),
  at timestamptz not null default now(),
  action text not null,
  changes jsonb not null default '[]'
);

insert into labour_entries (log_date, zone, labourers, machines, note, user_id, created_at, legacy_wards)
select log_date, zone, sum(labourers)::int, sum(machines)::int,
       nullif(string_agg(case when coalesce(note, '') <> '' then 'Ward ' || ward || ': ' || note end, '; ' order by ward), ''),
       (array_agg(user_id order by at desc))[1], min(at), array_agg(ward order by ward)
  from labour_logs
 group by log_date, zone;

-- Starting accounts from deploy/initial-users.json, by key. A later release can add accounts (e.g. contracting
-- assistants) without re-creating the ones already made, even if their email was changed since.
create table starting_accounts (
  key text primary key,
  created_at timestamptz not null default now()
);
insert into starting_accounts (key)
select k from (values ('commissioner'), ('aee'), ('inspector')) as v(k) where exists (select 1 from users);

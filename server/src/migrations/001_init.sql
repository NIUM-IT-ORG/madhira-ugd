-- Users and roles. admin = Commissioner; editor = AEE / field inspector (limited to assigned wards); viewer = read only.
create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null,
  designation text,
  phone text,
  role text not null check (role in ('admin', 'editor', 'viewer')),
  password_hash text not null,
  all_wards boolean not null default false,
  wards int[] not null default '{}',
  active boolean not null default true,
  must_change_password boolean not null default true,
  token_version int not null default 0,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

-- Road stretches: drawn on the map, carrying the current status. History lives in stretch_versions.
create table stretches (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text,
  ward int not null,
  zone int not null,
  geometry jsonb not null,
  length_m double precision not null,
  pipe_ids text[] not null default '{}',
  planned_mh int not null default 0,
  status jsonb not null,
  approval text not null default 'none' check (approval in ('none', 'pending', 'approved', 'rejected')),
  stage text not null,
  open_issues int not null default 0,
  version int not null default 1,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_by uuid references users(id),
  updated_at timestamptz not null default now(),
  approved_by uuid references users(id),
  approved_at timestamptz,
  deleted_at timestamptz
);
create index stretches_ward on stretches (ward);

-- Every change to a stretch is a new row; rows are never updated or deleted.
create table stretch_versions (
  id bigserial primary key,
  stretch_id uuid not null references stretches(id),
  version int not null,
  kind text not null,
  user_id uuid references users(id),
  at timestamptz not null default now(),
  changes jsonb not null default '[]',
  status jsonb not null,
  approval text not null,
  geometry jsonb,
  note text,
  photos text[] not null default '{}',
  gps jsonb,
  gps_distance_m double precision,
  flagged_far boolean not null default false,
  warnings jsonb not null default '[]',
  batch_id uuid,
  unique (stretch_id, version)
);
create index stretch_versions_at on stretch_versions (at desc);

create table issues (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  kind text not null,
  stretch_id uuid references stretches(id),
  ward int,
  zone int,
  location jsonb,
  count int not null default 1,
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high')),
  status text not null default 'open' check (status in ('open', 'assigned', 'resolved')),
  description text,
  assigned_to text,
  due_date date,
  photos text[] not null default '{}',
  source text not null default 'manual' check (source in ('manual', 'stretch')),
  reported_by uuid references users(id),
  reported_at timestamptz not null default now(),
  updated_by uuid references users(id),
  updated_at timestamptz not null default now(),
  resolved_by uuid references users(id),
  resolved_at timestamptz,
  resolution_note text
);
create index issues_status on issues (status);
create index issues_stretch on issues (stretch_id);

create table issue_events (
  id bigserial primary key,
  issue_id uuid not null references issues(id),
  user_id uuid references users(id),
  at timestamptz not null default now(),
  action text not null,
  changes jsonb not null default '[]',
  note text
);

create table photos (
  id uuid primary key default gen_random_uuid(),
  path text not null,
  mime text not null,
  bytes int not null,
  lat double precision,
  lng double precision,
  accuracy double precision,
  taken_at timestamptz,
  uploaded_by uuid references users(id),
  uploaded_at timestamptz not null default now()
);

create table labour_logs (
  id bigserial primary key,
  log_date date not null,
  ward int not null,
  zone int not null,
  labourers int not null check (labourers >= 0),
  machines int not null default 0 check (machines >= 0),
  note text,
  user_id uuid references users(id),
  at timestamptz not null default now(),
  unique (log_date, ward)
);

create table audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id uuid references users(id),
  action text not null,
  entity text,
  entity_id text,
  detail jsonb,
  ip text
);

create table counters (
  name text primary key,
  value int not null
);

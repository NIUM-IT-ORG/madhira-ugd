-- Additions and deletions of stretches, pipes and manholes proposed by AEEs take effect only when the
-- Commissioner approves them. Status updates on existing stretches are not affected.
alter table stretches add column record_state text not null default 'active' check (record_state in ('proposed', 'active', 'rejected'));

create table change_requests (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  entity text not null check (entity in ('stretch', 'pipe', 'manhole')),
  action text not null check (action in ('add', 'delete')),
  target_id text not null,
  payload jsonb,
  reason text,
  ward int,
  zone int,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  requested_by uuid references users(id),
  requested_at timestamptz not null default now(),
  decided_by uuid references users(id),
  decided_at timestamptz,
  decision_note text
);
create index change_requests_status on change_requests (status);

-- Approved changes to the sewer network, applied in order over the network extracted from the plans.
create table network_edits (
  id bigserial primary key,
  kind text not null check (kind in ('pipe', 'manhole')),
  feature_id text not null,
  op text not null check (op in ('add', 'delete')),
  geometry jsonb,
  properties jsonb,
  change_request_id uuid references change_requests(id),
  user_id uuid references users(id),
  at timestamptz not null default now()
);

-- Clean-ups done by the Commissioner on the Storage page (what was deleted, up to which date, how much space).
create table storage_purges (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id uuid references users(id),
  before_date date not null,
  categories text[] not null,
  summary jsonb not null,
  bytes_freed bigint not null default 0
);

-- Saves sent again by a phone that never received the reply (lost signal): the first result is returned
-- instead of creating a second record. Keys older than 30 days are removed at start-up.
create table request_keys (
  key text primary key,
  user_id uuid,
  status int not null,
  body text not null,
  at timestamptz not null default now()
);

-- SMOKESHOW notification backend — Postgres schema.
--
-- Five tables. The shape is dictated by one query (`listOccupiedCells`, at the
-- bottom of this file) which runs once an hour and must stay cheap as the
-- subscriber count grows: it returns *cells*, not users, and it is the only
-- thing standing between this service and a bill that scales with signups.
--
-- The in-memory implementation in src/store.js mirrors this exactly. If you
-- change one, change both — the tests run against the memory store.

create table if not exists devices (
  id                   text primary key,
  secret_hash          text        not null,   -- sha256 of the bearer secret; the secret itself is never stored
  platform             text        not null check (platform in ('ios','ipados','macos','android')),
  push_token           text,                   -- null once a provider tells us it is dead
  app_user_id          text        not null,   -- RevenueCat identity; defaults to `id`
  timezone             text,                   -- IANA, device-reported, for quiet hours
  threshold            smallint    not null default 2 check (threshold between 0 and 4),
  quiet_enabled        boolean     not null default true,
  quiet_start          smallint    not null default 22 check (quiet_start between 0 and 23),
  quiet_end            smallint    not null default 7  check (quiet_end between 0 and 23),
  sensitive_household  boolean     not null default false,
  enabled              boolean     not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- No email column, no name column, no analytics column. There is nothing here
-- that identifies a person, which is why deleting the row is a complete
-- deletion.

create table if not exists device_locations (
  device_id  text        not null references devices(id) on delete cascade,
  cell_key   text        not null,             -- snapCoord() lattice key, "45.0000,-93.3000"
  label      text,                             -- display only; never joined on
  lat        double precision not null,        -- the user's real coordinates, kept for a lattice migration
  lon        double precision not null,
  threshold  smallint    check (threshold between 0 and 4),  -- null = inherit the device default
  created_at timestamptz not null default now(),
  primary key (device_id, lat, lon)
);

-- The fan-out join. Every run reads this index and nothing else from this table.
create index if not exists device_locations_cell_idx on device_locations (cell_key);

create table if not exists entitlements (
  app_user_id     text primary key,
  active          boolean     not null default false,
  revoked         boolean     not null default false,
  will_renew      boolean,
  billing_issue   boolean     not null default false,
  expires_at      timestamptz,                 -- RevenueCat's expiration_at_ms, grace period included
  product_id      text,
  period_type     text,                        -- TRIAL | INTRO | NORMAL
  store           text,
  environment     text,
  last_event_id   text,
  last_event_type text,
  updated_at      timestamptz not null default now()
);

-- RevenueCat aliases and transfers rewrite identity without touching access.
create table if not exists app_user_aliases (
  alias_id     text primary key,
  canonical_id text        not null,
  created_at   timestamptz not null default now()
);

-- One row per occupied cell. The service's entire memory of "what the air was
-- doing last hour" — derived scalars only, never the 192-hour payload.
create table if not exists cell_states (
  cell_key   text primary key,
  state      jsonb       not null,
  updated_at timestamptz not null default now()
);

-- The exactly-once ledger. The primary key IS the guarantee: a duplicate
-- insert is a constraint violation, not a duplicate notification.
create table if not exists sent_notifications (
  device_id  text        not null references devices(id) on delete cascade,
  dedupe_key text        not null,
  cell_key   text        not null,
  sent_at    timestamptz not null default now(),
  primary key (device_id, dedupe_key)
);

create index if not exists sent_notifications_prune_idx on sent_notifications (sent_at);
create index if not exists sent_notifications_recent_idx on sent_notifications (device_id, cell_key, sent_at desc);

-- The hot query, verbatim from store.pg.js. Read it as the cost model:
-- the row count it returns is the number of forecast fetches per hour, and it
-- is bounded by geography, not by subscriber count.
--
--   select distinct l.cell_key
--     from device_locations l
--     join devices d on d.id = l.device_id
--     left join app_user_aliases a on a.alias_id = d.app_user_id
--     join entitlements e on e.app_user_id = coalesce(a.canonical_id, d.app_user_id)
--    where d.enabled
--      and d.push_token is not null
--      and not e.revoked
--      and (case when e.expires_at is null then e.active else e.expires_at > now() end);

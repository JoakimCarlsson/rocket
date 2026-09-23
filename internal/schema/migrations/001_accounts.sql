create table users (
    id          uuid primary key default uuidv7(),
    google_sub  text        not null unique,
    email       text        not null,
    name        text        not null default '',
    picture_url text        not null default '',
    created_at  timestamptz not null default now()
);

create table sessions (
    id         uuid primary key default uuidv7(),
    user_id    uuid        not null references users (id) on delete cascade,
    token_hash bytea       not null unique,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null
);

create index sessions_user_idx on sessions (user_id);


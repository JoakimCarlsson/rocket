create table rockets (
    id         uuid primary key default uuidv7(),
    user_id    uuid        not null references users (id) on delete cascade,
    name       text        not null,
    prompt     text        not null default '',
    config     jsonb       not null,
    likes      integer     not null default 0,
    created_at timestamptz not null default now()
);

create index rockets_user_idx on rockets (user_id);

create table rocket_likes (
    user_id    uuid        not null references users (id) on delete cascade,
    rocket_id  uuid        not null references rockets (id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (user_id, rocket_id)
);

create index rocket_likes_rocket_idx on rocket_likes (rocket_id);

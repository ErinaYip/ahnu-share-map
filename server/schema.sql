-- 本地自包含后端（SQLite）数据结构。
-- 这是原 Supabase 迁移 001/004/005/006 的等价物，供单机运行。

create table if not exists admin_users (
  id integer primary key autoincrement,
  username text not null unique,
  email text,
  password_hash text not null,
  created_at text not null
);

create table if not exists sessions (
  token text primary key,
  admin_id integer not null references admin_users(id) on delete cascade,
  created_at text not null,
  expires_at text not null
);

create table if not exists categories (
  id text primary key,
  label text not null,
  color text not null,
  sort_order integer not null default 0,
  is_active integer not null default 1
);

create table if not exists detail_fields (
  key text primary key,
  label text not null,
  default_value text,
  sort_order integer not null default 0,
  is_active integer not null default 1
);

create table if not exists places (
  id text primary key,
  name text not null,
  recommendation text not null,
  category_id text references categories(id),
  latitude real not null,
  longitude real not null,
  address text,
  hours text,
  price text,
  best_for text,
  rating real,
  cover_url text,
  image_urls text not null default '[]',
  tags text not null default '[]',
  highlights text not null default '[]',
  custom_details text not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  query_code text not null unique,
  rejection_reason text,
  submitted_at text not null,
  reviewed_at text,
  reviewed_by integer references admin_users(id)
);

create index if not exists places_status_idx on places(status);
create index if not exists places_query_code_idx on places(query_code);

create table if not exists reaction_definitions (
  value text primary key,
  emoji text not null,
  label text not null,
  sort_order integer not null default 0,
  is_active integer not null default 1
);

create table if not exists place_reactions (
  place_id text not null references places(id) on delete cascade,
  voter_hash text not null,
  reaction text not null references reaction_definitions(value),
  created_at text not null,
  updated_at text not null,
  primary key (place_id, voter_hash)
);

create table if not exists place_reaction_options (
  place_id text not null references places(id) on delete cascade,
  reaction_value text not null references reaction_definitions(value),
  is_enabled integer not null default 1,
  primary key (place_id, reaction_value)
);

create table if not exists place_reaction_adjustments (
  place_id text not null references places(id) on delete cascade,
  reaction_value text not null references reaction_definitions(value),
  adjustment integer not null default 0,
  primary key (place_id, reaction_value)
);

create table if not exists recommendation_sort_settings (
  id integer primary key check (id = 1),
  distance_weight integer not null default 50,
  response_weight integer not null default 50,
  updated_at text not null
);

create table if not exists submission_rate_limits (
  rate_key text not null,
  day text not null,
  count integer not null default 0,
  primary key (rate_key, day)
);

-- 默认分类（可由管理员在后台修改）
insert or ignore into categories(id, label, color, sort_order, is_active) values
  ('food', '吃喝', '#ec7356', 10, 1),
  ('fun', '娱乐', '#63a47d', 20, 1),
  ('study', '学习', '#5c9bd1', 30, 1),
  ('shop', '购物', '#9b7cc4', 40, 1),
  ('exercise', '运动', '#f4b35e', 50, 1);

-- 默认详情字段
insert or ignore into detail_fields(key, label, default_value, sort_order, is_active) values
  ('hours', '营业时间', '营业时间以店面为准', 10, 1),
  ('price', '人均消费', '价格以店面为准', 20, 1),
  ('bestFor', '适合', '随时去逛', 30, 1);

-- 默认表情
insert or ignore into reaction_definitions(value, emoji, label, sort_order, is_active) values
  ('like', '👍', '赞同', 10, 1),
  ('love', '❤️', '喜欢', 20, 1),
  ('fire', '🔥', '很棒', 30, 1),
  ('want_to_go', '👀', '想去', 40, 1);

insert or ignore into recommendation_sort_settings(id, distance_weight, response_weight, updated_at)
  values (1, 50, 50, '1970-01-01T00:00:00.000Z');

create extension if not exists pgcrypto;

create type public.task_status as enum ('inbox','planned','active','completed','cancelled');
create type public.block_kind as enum ('sleep','routine','event','travel','task','meal','break','growth','game','free');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  display_name text, avatar_url text, onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1
);
create table public.user_settings (
  id uuid primary key default gen_random_uuid(), user_id uuid not null unique references auth.users(id) on delete cascade,
  timezone text not null default 'Asia/Tokyo', target_sleep_minutes integer not null default 420,
  morning_prep_minutes integer not null default 52, default_travel_minutes integer not null default 30,
  calendar_write_mode text not null default 'confirm' check (calendar_write_mode in ('confirm','today','all','readonly')),
  notification_enabled boolean not null default false, ai_enabled boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1
);
create table public.projects (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  title text not null, goal text, deadline timestamptz, status text not null default 'active', progress integer not null default 0 check(progress between 0 and 100),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1
);
create table public.milestones (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, project_id uuid references public.projects(id) on delete cascade,
  title text not null, due_at timestamptz, completed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1
);
create table public.tasks (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, project_id uuid references public.projects(id) on delete set null,
  title text not null, notes text, status public.task_status not null default 'inbox', priority smallint not null default 2 check(priority between 1 and 4),
  estimate_minutes integer not null default 30 check(estimate_minutes > 0), actual_minutes integer not null default 0 check(actual_minutes >= 0), due_at timestamptz,
  required boolean not null default false, parent_task_id uuid references public.tasks(id) on delete set null, completed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1
);
create table public.task_dependencies (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade, depends_on_task_id uuid not null references public.tasks(id) on delete cascade,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1, unique(task_id, depends_on_task_id)
);
create table public.calendar_connections (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'google', provider_account_id text, encrypted_refresh_token text, access_token_expires_at timestamptz,
  selected_calendar_ids text[] not null default '{}', write_mode text not null default 'confirm', sync_token text, last_synced_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1, unique(user_id, provider)
);
create table public.external_calendar_events (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid references public.calendar_connections(id) on delete cascade, external_calendar_id text not null, external_event_id text not null,
  etag text, title text not null, starts_at timestamptz not null, ends_at timestamptz not null, location text, status text, raw jsonb not null default '{}', deleted_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1,
  unique(user_id, external_calendar_id, external_event_id)
);
create table public.daily_plans (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  plan_date date not null, status text not null default 'draft', source text not null default 'fallback', summary text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1, unique(user_id, plan_date)
);
create table public.plan_blocks (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, daily_plan_id uuid references public.daily_plans(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null, title text not null, kind public.block_kind not null, starts_at timestamptz not null, ends_at timestamptz not null,
  status text not null default 'planned', fixed boolean not null default false, metadata jsonb not null default '{}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1, check(ends_at > starts_at)
);
create table public.work_sessions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, task_id uuid references public.tasks(id) on delete set null,
  started_at timestamptz not null, ended_at timestamptz, planned_minutes integer, notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1
);

-- Remaining domain tables share a secure user-owned envelope and keep evolving fields in typed JSONB.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'locations','route_preferences','departure_plans','travel_records','routines','routine_steps','routine_executions',
    'sleep_plans','sleep_records','morning_plans','game_preferences','game_sessions','disposable_time_snapshots',
    'skill_areas','growth_goals','learning_sessions','artifact_records','daily_reflections','qol_records',
    'notifications','push_subscriptions','sync_queue','audit_logs'
  ] loop
    execute format('create table public.%I (
      id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
      name text, occurred_at timestamptz, data jsonb not null default ''{}''::jsonb,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1
    )', table_name);
  end loop;
end $$;

alter table public.push_subscriptions add column endpoint text generated always as (data->>'endpoint') stored;
create unique index push_subscriptions_endpoint_uidx on public.push_subscriptions(user_id, endpoint);
create index tasks_user_status_due_idx on public.tasks(user_id, status, due_at);
create index plan_blocks_user_time_idx on public.plan_blocks(user_id, starts_at, ends_at);
create index external_events_user_time_idx on public.external_calendar_events(user_id, starts_at, ends_at) where deleted_at is null;
create index projects_user_status_idx on public.projects(user_id, status);

create function public.set_updated_at() returns trigger language plpgsql security invoker set search_path = '' as $$
begin new.updated_at = now(); new.version = old.version + 1; return new; end; $$;

do $$ declare r record; begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', r.tablename);
    execute format('alter table public.%I enable row level security', r.tablename);
    execute format('alter table public.%I force row level security', r.tablename);
    execute format('create policy "owner select" on public.%I for select using ((select auth.uid()) = user_id)', r.tablename);
    execute format('create policy "owner insert" on public.%I for insert with check ((select auth.uid()) = user_id)', r.tablename);
    execute format('create policy "owner update" on public.%I for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', r.tablename);
    execute format('create policy "owner delete" on public.%I for delete using ((select auth.uid()) = user_id)', r.tablename);
  end loop;
end $$;

create function public.bootstrap_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles(id,user_id,display_name,avatar_url) values(new.id,new.id,coalesce(new.raw_user_meta_data->>'full_name','ChronoPilot User'),new.raw_user_meta_data->>'avatar_url');
  insert into user_settings(user_id) values(new.id);
  insert into projects(user_id,title,goal,deadline) values(new.id,'査読論文の修正','査読コメントへ回答し、品質を保って再投稿する',now()+interval '30 days');
  insert into routines(user_id,name,data) values
    (new.id,'朝ルーティン','{"steps":[["アラーム停止",2],["ベッドから出る",5],["水を飲む",2],["洗顔",5],["着替え",10],["朝食",15],["歯磨き",5],["荷物確認",5],["出発",3]]}'),
    (new.id,'夜ルーティン','{"steps":[["画面を閉じる",2],["入浴",20],["明日の確認",5]]}'),
    (new.id,'外出前ルーティン','{"steps":[["持ち物確認",5],["戸締まり",3]]}'),
    (new.id,'集中開始ルーティン','{"steps":[["通知を止める",1],["目的を書く",2]]}');
  insert into game_preferences(user_id,name,data) values(new.id,'ゲーム設定','{"weekdayMinutes":90,"holidayMinutes":150,"minimumMinutes":30,"maxContinuousMinutes":120,"bedtimeBufferMinutes":60,"treatAsRest":true}');
  insert into skill_areas(user_id,name,data) select new.id, value, '{"level":1}'::jsonb from jsonb_array_elements_text('["アルゴリズム","ソフトウェア設計","フロントエンド","バックエンド","データベース","インフラ","セキュリティ","AI・機械学習","テスト","UI/UX","プロダクト思考","OSS"]');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.bootstrap_user();

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on all tables in schema public from anon;

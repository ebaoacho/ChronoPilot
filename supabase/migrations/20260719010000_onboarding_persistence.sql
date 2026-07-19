-- Backfill users created before the initial bootstrap trigger was installed.
insert into public.profiles (id, user_id, display_name, avatar_url)
select u.id, u.id, coalesce(u.raw_user_meta_data->>'full_name', 'ChronoPilot User'), u.raw_user_meta_data->>'avatar_url'
from auth.users u
on conflict (user_id) do nothing;

insert into public.user_settings (user_id)
select u.id from auth.users u
on conflict (user_id) do nothing;

insert into public.game_preferences (user_id, name, data)
select u.id, 'ゲーム設定', '{"weekdayMinutes":90,"holidayMinutes":150,"minimumMinutes":30,"maxContinuousMinutes":120,"bedtimeBufferMinutes":60,"treatAsRest":true}'::jsonb
from auth.users u
where not exists (select 1 from public.game_preferences gp where gp.user_id = u.id);

-- Repair the exact partial-save state produced by older API versions.
update public.profiles p
set onboarding_completed = true
where p.onboarding_completed = false
  and exists (
    select 1 from public.growth_goals g
    where g.user_id = p.user_id and g.name = '目指すエンジニア像'
  );

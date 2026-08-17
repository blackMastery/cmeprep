-- Google/LinkedIn OIDC store the display name under 'name' in
-- raw_user_meta_data; email signups store 'full_name' (set by the register
-- action). Coalesce so OAuth signups get a profile name instead of null.
-- The on_auth_user_created trigger already points here — no recreate needed.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name'
    )
  );
  return new;
end;
$$;

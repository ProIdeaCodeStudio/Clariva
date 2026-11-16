create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  profile_name text;
  profile_phone text;
  profile_level text;
begin
  profile_name := nullif(pg_catalog.btrim(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')), '');
  profile_phone := nullif(pg_catalog.btrim(coalesce(new.raw_user_meta_data ->> 'phone', '')), '');
  profile_level := case
    when new.raw_user_meta_data ->> 'level' in ('100', '200')
      then new.raw_user_meta_data ->> 'level'
    else null
  end;

  insert into public.students (
    user_id, "Name", "E-mail", "Phone No.", "Level", "Role", "Verified"
  )
  values (
    new.id, profile_name, new.email, profile_phone, profile_level,
    'student', new.email_confirmed_at is not null
  )
  on conflict (user_id) do nothing;

  return new;
end;
$function$;

revoke all on function private.handle_new_auth_user() from public, anon, authenticated, service_role;

create or replace function private.sync_student_email_verification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  update public.students
  set "Verified" = (new.email_confirmed_at is not null)
  where user_id = new.id
    and pg_catalog.lower(coalesce("Role", 'student')) = 'student';

  return new;
end;
$function$;

revoke all on function private.sync_student_email_verification() from public, anon, authenticated, service_role;

drop trigger if exists on_auth_user_created_clariva on auth.users;
create trigger on_auth_user_created_clariva
after insert on auth.users
for each row
execute function private.handle_new_auth_user();

drop trigger if exists on_auth_email_confirmation_changed_clariva on auth.users;
create trigger on_auth_email_confirmation_changed_clariva
after update of email_confirmed_at on auth.users
for each row
when (old.email_confirmed_at is distinct from new.email_confirmed_at)
execute function private.sync_student_email_verification();

update public.students s
set "Verified" = (u.email_confirmed_at is not null)
from auth.users u
where u.id = s.user_id
  and pg_catalog.lower(coalesce(s."Role", 'student')) = 'student'
  and s."Verified" is distinct from (u.email_confirmed_at is not null);

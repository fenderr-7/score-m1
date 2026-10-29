-- Student Score Management System (M.1) - isolated score_* schema.
-- Run only in the dedicated score project. This migration does not modify legacy app tables.
begin;

create table if not exists public.score_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role text not null default 'pending' check (role in ('pending','teacher','admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.score_classrooms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  grade_level text not null default 'ม.1',
  academic_year text not null default '2569',
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (name, academic_year, created_by)
);

create table if not exists public.score_subjects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  classroom_id uuid not null references public.score_classrooms(id) on delete cascade,
  term text not null default 'ภาคเรียนที่ 1 / 2569',
  teacher_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

-- These two columns are deliberately named exactly as the web form expects:
-- student_code = รหัสนักเรียน, full_name = ชื่อ-นามสกุล.
create table if not exists public.score_students (
  id uuid primary key default gen_random_uuid(),
  student_code text not null,
  full_name text not null,
  classroom_id uuid not null references public.score_classrooms(id) on delete cascade,
  active boolean not null default true,
  pin_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint student_code_nonblank check (length(trim(student_code)) between 1 and 40),
  constraint student_name_nonblank check (length(trim(full_name)) between 1 and 160)
);

-- Upgrade safety for an early score-m1 database where the student table existed
-- but the expected fields had not been added yet.
alter table public.score_students add column if not exists student_code text;
alter table public.score_students add column if not exists full_name text;
alter table public.score_students add column if not exists classroom_id uuid references public.score_classrooms(id) on delete cascade;
alter table public.score_students add column if not exists active boolean not null default true;
alter table public.score_students add column if not exists pin_hash text;
alter table public.score_students add column if not exists created_at timestamptz not null default now();
alter table public.score_students add column if not exists updated_at timestamptz not null default now();

create unique index if not exists score_students_student_code_unique on public.score_students (lower(trim(student_code)));
create index if not exists score_students_classroom_code_idx on public.score_students (classroom_id, student_code);

create table if not exists public.score_assessments (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.score_subjects(id) on delete cascade,
  title text not null,
  max_score numeric(8,2) not null check (max_score > 0),
  assessment_type text not null default 'งาน/ใบงาน',
  visible_to_students boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.score_scores (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.score_students(id) on delete cascade,
  assessment_id uuid not null references public.score_assessments(id) on delete cascade,
  score numeric(8,2),
  status text not null default 'pending' check (status in ('pending','graded','absent','missing')),
  feedback text,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (student_id, assessment_id),
  check (score is null or score >= 0)
);

-- Public score lookup throttling. No direct access is granted to browser roles.
create table if not exists public.score_student_lookup_attempts (
  id bigint generated always as identity primary key,
  student_code text not null,
  ip_hash text not null,
  success boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists student_lookup_attempts_recent_idx
  on public.score_student_lookup_attempts (ip_hash, student_code, created_at desc);

alter table public.score_profiles enable row level security;
alter table public.score_classrooms enable row level security;
alter table public.score_subjects enable row level security;
alter table public.score_students enable row level security;
alter table public.score_assessments enable row level security;
alter table public.score_scores enable row level security;
alter table public.score_student_lookup_attempts enable row level security;

-- Remove any default/public table grants first. Only authenticated teacher policies
-- and the server-only service_role should have access to these isolated score tables.
revoke all privileges on table
  public.score_profiles,
  public.score_classrooms,
  public.score_subjects,
  public.score_students,
  public.score_assessments,
  public.score_scores,
  public.score_student_lookup_attempts
from anon, PUBLIC;

-- Expose only the privileges required by authenticated teachers. The Edge Functions
-- use server-side credentials for student lookup/PIN writes; never expose those keys.
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.score_profiles to authenticated;
grant select, insert, update, delete on public.score_classrooms to authenticated;
grant select, insert, update, delete on public.score_subjects to authenticated;
grant select, insert, update, delete on public.score_students to authenticated;
grant select, insert, update, delete on public.score_assessments to authenticated;
grant select, insert, update, delete on public.score_scores to authenticated;
revoke all on public.score_student_lookup_attempts from anon, authenticated;
grant all on public.score_profiles, public.score_classrooms, public.score_subjects, public.score_students, public.score_assessments, public.score_scores, public.score_student_lookup_attempts to service_role;
grant usage, select on all sequences in schema public to service_role;

drop policy if exists profiles_read_self on public.score_profiles;
create policy profiles_read_self on public.score_profiles for select to authenticated
using (user_id = (select auth.uid()));
-- Profile roles are managed by a trusted administrator in the SQL Editor, not by the browser.

drop policy if exists classrooms_select_owner_teacher on public.score_classrooms;
create policy classrooms_select_owner_teacher on public.score_classrooms for select to authenticated
using (created_by = (select auth.uid()) and exists (
  select 1 from public.score_profiles p where p.user_id = (select auth.uid()) and p.role in ('teacher','admin')
));
drop policy if exists classrooms_insert_owner_teacher on public.score_classrooms;
create policy classrooms_insert_owner_teacher on public.score_classrooms for insert to authenticated
with check (created_by = (select auth.uid()) and exists (
  select 1 from public.score_profiles p where p.user_id = (select auth.uid()) and p.role in ('teacher','admin')
));
drop policy if exists classrooms_update_owner_teacher on public.score_classrooms;
create policy classrooms_update_owner_teacher on public.score_classrooms for update to authenticated
using (created_by = (select auth.uid()) and exists (select 1 from public.score_profiles p where p.user_id = (select auth.uid()) and p.role in ('teacher','admin')))
with check (created_by = (select auth.uid()) and exists (select 1 from public.score_profiles p where p.user_id = (select auth.uid()) and p.role in ('teacher','admin')));
drop policy if exists classrooms_delete_owner_teacher on public.score_classrooms;
create policy classrooms_delete_owner_teacher on public.score_classrooms for delete to authenticated
using (created_by = (select auth.uid()) and exists (select 1 from public.score_profiles p where p.user_id = (select auth.uid()) and p.role in ('teacher','admin')));

drop policy if exists subjects_access_owner on public.score_subjects;
create policy subjects_access_owner on public.score_subjects for all to authenticated
using (exists (select 1 from public.score_classrooms c where c.id = classroom_id and c.created_by = (select auth.uid()))
  and exists (select 1 from public.score_profiles p where p.user_id = (select auth.uid()) and p.role in ('teacher','admin')))
with check (exists (select 1 from public.score_classrooms c where c.id = classroom_id and c.created_by = (select auth.uid()))
  and teacher_id = (select auth.uid())
  and exists (select 1 from public.score_profiles p where p.user_id = (select auth.uid()) and p.role in ('teacher','admin')));

drop policy if exists students_access_class_owner on public.score_students;
create policy students_access_class_owner on public.score_students for all to authenticated
using (exists (select 1 from public.score_classrooms c where c.id = classroom_id and c.created_by = (select auth.uid()))
  and exists (select 1 from public.score_profiles p where p.user_id = (select auth.uid()) and p.role in ('teacher','admin')))
with check (exists (select 1 from public.score_classrooms c where c.id = classroom_id and c.created_by = (select auth.uid()))
  and exists (select 1 from public.score_profiles p where p.user_id = (select auth.uid()) and p.role in ('teacher','admin')));

drop policy if exists assessments_access_subject_owner on public.score_assessments;
create policy assessments_access_subject_owner on public.score_assessments for all to authenticated
using (exists (
  select 1 from public.score_subjects s join public.score_classrooms c on c.id = s.classroom_id
  where s.id = subject_id and c.created_by = (select auth.uid())
) and exists (select 1 from public.score_profiles p where p.user_id = (select auth.uid()) and p.role in ('teacher','admin')))
with check (exists (
  select 1 from public.score_subjects s join public.score_classrooms c on c.id = s.classroom_id
  where s.id = subject_id and c.created_by = (select auth.uid())
) and exists (select 1 from public.score_profiles p where p.user_id = (select auth.uid()) and p.role in ('teacher','admin')));

drop policy if exists scores_access_teacher_owned on public.score_scores;
create policy scores_access_teacher_owned on public.score_scores for all to authenticated
using (exists (
  select 1 from public.score_students st
  join public.score_classrooms c on c.id = st.classroom_id
  join public.score_assessments a on a.id = assessment_id
  join public.score_subjects su on su.id = a.subject_id and su.classroom_id = c.id
  where st.id = student_id and c.created_by = (select auth.uid())
) and exists (select 1 from public.score_profiles p where p.user_id = (select auth.uid()) and p.role in ('teacher','admin')))
with check (exists (
  select 1 from public.score_students st
  join public.score_classrooms c on c.id = st.classroom_id
  join public.score_assessments a on a.id = assessment_id
  join public.score_subjects su on su.id = a.subject_id and su.classroom_id = c.id
  where st.id = student_id and c.created_by = (select auth.uid())
) and exists (select 1 from public.score_profiles p where p.user_id = (select auth.uid()) and p.role in ('teacher','admin')));

-- A pending profile is not allowed to create classes or change grades until a trusted admin
-- explicitly promotes it to role='teacher' or role='admin' in the Supabase SQL Editor.
commit();

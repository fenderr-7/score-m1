# คู่มือติดตั้ง Supabase — ระบบคะแนนนักเรียน ม.1

> โปรเจกต์ใหม่ได้รับการสร้างแล้ว: `kbcdzxoniaonymsmdevz` (`score-phuwanat-m1`). Migration จะถูกใช้กับโปรเจกต์นี้เท่านั้น

## 1. เชื่อมโปรเจกต์ใหม่
```bash
supabase login
supabase link --project-ref kbcdzxoniaonymsmdevz
```

## 2. สร้างตาราง
รัน `supabase/migrations/20261029130000_score_schema.sql` ใน SQL Editor ของโปรเจกต์คะแนนใหม่เท่านั้น สคริปต์สร้างเฉพาะตาราง `score_*` และไม่แก้ตาราง `students` หรือ `breakfast_records` ของระบบอาหารเช้า

## 3. กำหนดสิทธิ์ครู
สร้างผู้ใช้ที่ Authentication → Users แล้วใช้ UUID จริง:

```sql
insert into public.score_profiles (user_id, full_name, role)
values ('TEACHER-UUID', 'ครูภูวเนศ อิทธิสิริศักดิ์', 'teacher')
on conflict (user_id) do update
set full_name = excluded.full_name, role = excluded.role;
```

## 4. Deploy Edge Functions
กำหนด secrets ใน environment ฝั่ง Supabase Functions เท่านั้น:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

```bash
supabase functions deploy set-student-pin
supabase functions deploy student-score-lookup
```

## 5. ตั้งค่าเว็บ
ค่า Project URL และ Publishable key ได้ตั้งไว้ใน `config.js` แล้ว. ห้ามใส่ Service Role/Secret key ใน client-side code.

## 6. ทดสอบความปลอดภัย
ตรวจ Security Advisors, RLS, การจำกัดห้องของครู, PIN ผิด, และยืนยันนักเรียนเห็นเฉพาะคะแนนตัวเองผ่าน Edge Function


## Create the initial teacher account
1. In Supabase Dashboard → Authentication → Users, add/invite `phuwanet.2543@hongson.ac.th` and complete password setup.
2. Copy that user's UUID.
3. In SQL Editor for project `score-phuwanat-m1`, run the following after replacing `TEACHER-UUID`:

```sql
insert into public.score_profiles (user_id, full_name, role)
values ('TEACHER-UUID', 'ครูภูวเนศ อิทธิสิริศักดิ์', 'teacher')
on conflict (user_id) do update
set full_name = excluded.full_name, role = excluded.role;
```

Do not grant teacher role to an unknown account. The current project has no Auth user with the teacher email yet.

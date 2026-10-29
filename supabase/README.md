# คู่มือติดตั้ง Supabase — ระบบคะแนนนักเรียน ม.1

> ยังรอการยืนยัน Supabase organization/project ใหม่ ห้ามรัน migration จนกว่าจะยืนยัน Project Ref

## 1. เชื่อมโปรเจกต์ใหม่
```bash
supabase login
supabase link --project-ref YOUR_NEW_PROJECT_REF
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
ใส่ Project URL และ Publishable key ใน `config.js`. ห้ามใส่ Service Role/Secret key ใน client-side code.

## 6. ทดสอบความปลอดภัย
ตรวจ Security Advisors, RLS, การจำกัดห้องของครู, PIN ผิด, และยืนยันนักเรียนเห็นเฉพาะคะแนนตัวเองผ่าน Edge Function

# ระบบเก็บคะแนนนักเรียนออนไลน์ ม.1 — ครูภูวเนศ อิทธิสิริศักดิ์

Repository: https://fenderr-7.github.io/score-m1/

## สถานะ
- Source transferred into a new Repository for the new account.
- The application now refers to a separate `score_*` table namespace.
- Supabase is **not yet configured** in this repository: `config.js` is a placeholder until the correct new account/project can be verified.
- Do not run SQL against the existing breakfast or homecoming project.

## ฟังก์ชัน
- ครูเข้าสู่ระบบ Supabase Auth เพื่อจัดการห้องเรียน วิชา นักเรียน รายการประเมิน และคะแนน
- กรอกคะแนนในตาราง
- นำเข้ารายชื่อนักเรียนจาก CSV
- นักเรียนค้นคะแนนด้วยรหัสนักเรียนและ PIN ผ่าน Edge Function
- RLS จำกัดสิทธิ์ครู และป้องกันการอ่านตารางคะแนนโดยตรงจากผู้ใช้ทั่วไป

## ไฟล์สำคัญ
- `online.html` — เว็บแอป
- `config.js` — Supabase URL และ Publishable key เท่านั้น
- `supabase/migrations/20261029130000_score_schema.sql` — ตารางคะแนนแยกส่วน
- `supabase/functions/` — ตั้ง PIN / ค้นคะแนน
- `.github/workflows/pages.yml` — เผยแพร่ผ่าน GitHub Pages

## ขั้นตอนก่อนเปิดใช้
1. ยืนยัน Supabase account/organization ใหม่และสร้างโปรเจกต์คะแนน หลังตรวจสอบโควตาและค่าใช้จ่าย
2. อัปเดต `config.js` ด้วย URL และ Publishable key ของโปรเจกต์ใหม่เท่านั้น
3. ตรวจทานและรัน migration เฉพาะในโปรเจกต์คะแนนใหม่
4. สร้างบัญชีครูใน Authentication และกำหนด role ผ่าน `score_profiles`
5. Deploy Edge Functions พร้อม secrets ฝั่ง server
6. เปิด GitHub Pages และทดสอบการเพิ่มนักเรียน บันทึกคะแนน RLS และการค้นข้ามบัญชีก่อนใช้งานจริง

## ความปลอดภัย
- PIN hash ใช้ PBKDF2-HMAC-SHA-256 120,000 iterations พร้อม salt ต่อคน
- Lookup จำกัดความถี่ตาม IP hash และรหัสนักเรียน
- ห้ามนำ Service Role key หรือ Secret key ใส่ในหน้าเว็บหรือ commit ลง GitHub

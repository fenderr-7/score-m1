import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
async function hashPin(pin: string, salt: string) {
  const material = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    salt: new TextEncoder().encode(salt),
    iterations: 120000,
    hash: "SHA-256",
  }, material, 256);
  return hex(new Uint8Array(bits));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "ต้องเข้าสู่ระบบครูก่อน" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData.user) return json({ error: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่" }, 401);

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: profile, error: profileError } = await admin
      .from("score_profiles").select("role").eq("user_id", userData.user.id).maybeSingle();
    if (profileError) throw profileError;
    if (!profile || !["teacher", "admin"].includes(profile.role)) return json({ error: "บัญชีนี้ไม่มีสิทธิ์ครู" }, 403);

    const body = await req.json().catch(() => ({}));
    const studentId = String(body.student_id || "").trim();
    const pin = String(body.pin || "").trim();
    if (!studentId || !/^\d{6,8}$/.test(pin)) return json({ error: "ระบุรหัสนักเรียนและ PIN 6–8 หลักให้ถูกต้อง" }, 400);

    const { data: student, error: studentError } = await admin
      .from("score_students").select("id,classroom_id").eq("id", studentId).maybeSingle();
    if (studentError) throw studentError;
    if (!student) return json({ error: "ไม่พบนักเรียน" }, 404);

    const { data: classroom, error: classError } = await admin
      .from("score_classrooms").select("id,created_by").eq("id", student.classroom_id).maybeSingle();
    if (classError) throw classError;
    if (!classroom || (profile.role !== "admin" && classroom.created_by !== userData.user.id)) {
      return json({ error: "คุณไม่มีสิทธิ์จัดการนักเรียนคนนี้" }, 403);
    }

    const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
    const hash = await hashPin(pin, salt);
    const { error: updateError } = await admin.from("score_students").update({
      pin_hash: `pbkdf2-sha256$120000$${salt}$${hash}`,
      updated_at: new Date().toISOString(),
    }).eq("id", studentId);
    if (updateError) throw updateError;
    return json({ ok: true });
  } catch (error) {
    console.error("set-student-pin error", error);
    return json({ error: "ตั้ง PIN ไม่สำเร็จ กรุณาตรวจสอบฐานข้อมูลและลองอีกครั้ง" }, 500);
  }
});

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://fenderr-7.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });
function hex(bytes: Uint8Array) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
async function digest(text: string) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));
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
async function pinMatches(stored: string | null, pin: string) {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2-sha256" || parts[1] !== "120000") return false;
  const salt = parts[2], expected = parts[3];
  if (!/^[0-9a-f]{32}$/.test(salt) || !/^[0-9a-f]{64}$/.test(expected)) return false;
  const actual = await hashPin(pin, salt);
  let mismatch = 0;
  for (let i = 0; i < actual.length; i++) mismatch |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return mismatch === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const code = String(body.student_code || "").trim();
    const pin = String(body.pin || "").trim();
    if (!code || code.length > 40 || !/^\d{6,8}$/.test(pin)) return json({ error: "กรอกรหัสนักเรียนและ PIN 6–8 หลักให้ถูกต้อง" }, 400);

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    const normalizedCode = code.toUpperCase();
    const forwarded = req.headers.get("x-forwarded-for") || "unknown";
    const ipHash = await digest(forwarded.split(",")[0].trim());
    const recent = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { count, error: rateError } = await admin
      .from("score_student_lookup_attempts").select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash).gte("created_at", recent);
    if (rateError) throw rateError;
    if ((count || 0) >= 20) return json({ error: "ค้นหาหลายครั้งเกินไป กรุณารอ 10 นาทีแล้วลองใหม่" }, 429);
    const { count: codeCount, error: codeRateError } = await admin
      .from("score_student_lookup_attempts").select("id", { count: "exact", head: true })
      .eq("student_code", normalizedCode).gte("created_at", recent);
    if (codeRateError) throw codeRateError;
    if ((codeCount || 0) >= 10) return json({ error: "รหัสนักเรียนนี้มีการค้นหามากเกินไป กรุณารอ 10 นาทีแล้วลองใหม่" }, 429);
    const { data: student, error: studentError } = await admin
      .from("score_students").select("id,student_code,full_name,classroom_id,active,pin_hash")
      .ilike("student_code", normalizedCode).maybeSingle();
    if (studentError) throw studentError;

    const matched = !!student && student.active && await pinMatches(student.pin_hash, pin);
    const { error: attemptInsertError } = await admin.from("score_student_lookup_attempts").insert({
      student_code: normalizedCode, ip_hash: ipHash, success: matched,
    });
    if (attemptInsertError) throw attemptInsertError;
    if (!matched || !student) return json({ error: "ไม่พบข้อมูล หรือรหัสนักเรียน / PIN ไม่ถูกต้อง" }, 401);

    const { data: classroom, error: classroomError } = await admin
      .from("score_classrooms").select("id,name").eq("id", student.classroom_id).maybeSingle();
    if (classroomError) throw classroomError;
    const { data: subjects, error: subjectError } = await admin
      .from("score_subjects").select("id,name").eq("classroom_id", student.classroom_id);
    if (subjectError) throw subjectError;
    const subjectIds = (subjects || []).map((s: {id:string}) => s.id);
    let published: any[] = [];
    if (subjectIds.length) {
      const { data, error } = await admin.from("score_assessments")
        .select("id,subject_id,title,max_score,visible_to_students")
        .in("subject_id", subjectIds).eq("visible_to_students", true).order("sort_order");
      if (error) throw error;
      published = data || [];
    }
    const { data: studentScores, error: scoresError } = await admin
      .from("score_scores").select("assessment_id,score,status,feedback").eq("student_id", student.id);
    if (scoresError) throw scoresError;
    const subjectById = new Map((subjects || []).map((s: {id:string,name:string}) => [s.id,s.name]));
    const scoreByAssessment = new Map((studentScores || []).map((s: any) => [s.assessment_id,s]));
    const scores = published.map((a: any) => {
      const s: any = scoreByAssessment.get(a.id);
      const status = s?.status || "pending";
      const labels: Record<string,string> = {
        pending: "รอคะแนน", graded: "ตรวจแล้ว", absent: "ขาดสอบ", missing: "ไม่ส่ง",
      };
      return {
        subject_name: subjectById.get(a.subject_id) || "รายวิชา",
        title: a.title, max_score: a.max_score,
        score: status === "graded" ? (s?.score ?? null) : null,
        status, status_label: labels[status] || "รอคะแนน",
        feedback: status === "graded" ? (s?.feedback || null) : null,
      };
    });
    return json({
      student: { student_code: student.student_code, full_name: student.full_name, classroom: classroom?.name || "" },
      scores,
    });
  } catch (error) {
    console.error("student-score-lookup error", error);
    return json({ error: "ค้นหาคะแนนไม่สำเร็จ กรุณาลองอีกครั้งภายหลัง" }, 500);
  }
});

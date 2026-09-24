import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SHEET_ID = process.env.GOOGLE_SHEET_ID || "10TUvN2-5otNh22h8ABDT3bzek6anbUxeJhjodvBfQzE";
const SHEET_GID = process.env.GOOGLE_SHEET_GID || "314429358";
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`;

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"') {
      if (quoted && next === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      row.push(cell); cell = "";
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && next === '\n') i++;
      row.push(cell); cell = "";
      if (row.some(v => v.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); if (row.some(v => v.trim() !== "")) rows.push(row); }
  return rows;
}

function normalizeHeader(value: string) {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/[\s\u00A0_\-\/\\()\[\]{}:：·•]/g, "")
    .toLowerCase();
}

function headerIndex(headers: string[], names: string[], containsTokens: string[] = []) {
  const normalized = headers.map(normalizeHeader);
  const exact = names
    .map(n => normalized.indexOf(normalizeHeader(n)))
    .find(i => i >= 0);
  if (exact !== undefined) return exact;

  const tokens = containsTokens.map(normalizeHeader).filter(Boolean);
  if (tokens.length) {
    const found = normalized.findIndex(h => tokens.some(t => h.includes(t)));
    if (found >= 0) return found;
  }
  return -1;
}

export async function GET() {
  try {
    const response = await fetch(CSV_URL, { cache: "no-store" });
    if (!response.ok) return NextResponse.json({ ok: false, error: `Google Sheets 응답 오류: ${response.status}` }, { status: 502 });
    const text = await response.text();
    if (!text || text.trim().startsWith("<!DOCTYPE") || text.includes("Sign in")) {
      return NextResponse.json({ ok: false, error: "Google Sheet가 공개 CSV로 읽히지 않습니다. Google Sheets에서 웹에 게시하거나 링크 공개 설정을 확인해주세요." }, { status: 403 });
    }

    const rows = parseCsv(text);
    if (rows.length < 2) return NextResponse.json({ ok: true, synced: 0, members: [] });
    const headers = rows[0];
    const nameIdx = headerIndex(headers, ["닉네임", "이름", "게임닉네임", "캐릭터명", "캐릭터닉네임"], ["닉네임", "캐릭터명"]);
    const jobIdx = headerIndex(headers, [
      "직업", "직업명", "클래스", "클래스명", "직업(클래스)", "직업 / 클래스", "Job", "Class"
    ], ["직업", "클래스", "job", "class"]);
    const powerIdx = headerIndex(headers, ["투력", "전투력", "전투력(투력)", "전투력/투력"], ["전투력", "투력"]);
    const memoIdx = headerIndex(headers, ["메모", "비고", "메모사항"], ["메모", "비고"]);
    if (nameIdx < 0 || powerIdx < 0) {
      return NextResponse.json({ ok: false, error: `시트 헤더를 찾지 못했습니다. 현재 헤더: ${headers.join(" / ")}` }, { status: 400 });
    }

    const members = rows.slice(1).map((r, i) => {
      const name = String(r[nameIdx] ?? "").trim();
      const job = jobIdx >= 0 ? String(r[jobIdx] ?? "").trim() : "";
      const powerText = powerIdx >= 0 ? String(r[powerIdx] ?? "").replace(/[,_\s]/g, "") : "0";
      const power = Number(powerText) || 0;
      const memo = memoIdx >= 0 ? String(r[memoIdx] ?? "").trim() : "";
      return { name, job, power, memo, row: i + 2 };
    }).filter(m => m.name);

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return NextResponse.json({ ok: false, error: "SUPABASE_SERVICE_ROLE_KEY 환경변수가 없습니다." }, { status: 500 });
    const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

    let synced = 0;
    const errors: Array<{ row: number; name: string; error: string }> = [];
    for (const m of members) {
      // Google Sheet is the source of truth for name/job/power.
      // memo remains editable from the website, so a blank sheet memo never erases it.
      const { data: existing, error: findError } = await admin.from("members").select("id,memo").eq("name", m.name).maybeSingle();
      if (findError) {
        errors.push({ row: m.row, name: m.name, error: findError.message });
        continue;
      }
      const payload: Record<string, unknown> = { name: m.name, job: m.job, power: m.power };
      if (m.memo) payload.memo = m.memo;
      const result = existing?.id
        ? await admin.from("members").update(payload).eq("id", existing.id)
        : await admin.from("members").insert(payload);
      if (result.error) {
        errors.push({ row: m.row, name: m.name, error: result.error.message });
      } else {
        synced++;
      }
    }

    if (errors.length) {
      return NextResponse.json({
        ok: false,
        error: `일부 길드원 저장에 실패했습니다. ${errors.length}건`,
        synced,
        rows: members.length,
        failed: errors.length,
        errors: errors.slice(0, 20),
        sheet: { id: SHEET_ID, gid: SHEET_GID },
      }, { status: 500 });
    }

    return NextResponse.json({ ok: true, synced, rows: members.length, members, sheet: { id: SHEET_ID, gid: SHEET_GID }, columns: { name: headers[nameIdx] ?? "", job: jobIdx >= 0 ? headers[jobIdx] : "찾지 못함", power: headers[powerIdx] ?? "", memo: memoIdx >= 0 ? headers[memoIdx] : "없음" }, jobValues: [...new Set(members.map(m => m.job).filter(Boolean))].slice(0, 30), fetchedAt: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Google Sheets 동기화 실패" }, { status: 500 });
  }
}

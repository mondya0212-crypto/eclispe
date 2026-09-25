import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const SHEET_ID = process.env.GOOGLE_SHEET_ID || "10TUvN2-5otNh22h8ABDT3bzek6anbUxeJhjodvBfQzE";
const SHEET_GID = process.env.GOOGLE_SHEET_GID || "1397643408";
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
    const response = await fetch(`${CSV_URL}&_ts=${Date.now()}-${Math.random().toString(36).slice(2)}`, { cache: "no-store", next: { revalidate: 0 } });
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

    const payloads: Array<Record<string, unknown>> = members.map((m) => {
      const payload: Record<string, unknown> = { name: m.name, job: m.job, power: m.power };
      // 빈 메모리는 기존 웹 메모리를 지우지 않습니다.
      if (m.memo) payload.memo = m.memo;
      return payload;
    });

    // 행마다 SELECT -> UPDATE/INSERT 하던 기존 방식은 길드원이 많을수록 매우 느렸습니다.
    // Supabase bulk upsert 한 번으로 처리해 동기화 시간을 크게 줄입니다.
    let syncError: string | null = null;
    if (payloads.length) {
      // 정상적인 경우에는 이름 unique key를 이용한 bulk upsert 한 번으로 끝냅니다.
      const result = await admin.from("members").upsert(payloads, { onConflict: "name" });
      if (result.error) {
        // 기존 DB가 오래된 스키마이거나 members_name_unique 인덱스가 실제
        // constraint로 인식되지 않는 경우에도 시트 동기화가 막히지 않도록
        // 기존 회원은 id 기준 일괄 UPDATE, 신규 회원은 일괄 INSERT 합니다.
        const names = payloads.map(p => String(p.name));
        const { data: existingMembers, error: lookupError } = await admin
          .from("members")
          .select("id,name")
          .in("name", names);

        if (lookupError) {
          syncError = `길드원 저장 실패: ${result.error.message} / 기존 회원 조회 실패: ${lookupError.message}`;
        } else {
          const existingByName = new Map((existingMembers || []).map(m => [m.name, m.id]));
          const updates = payloads.filter(p => existingByName.has(String(p.name)));
          const inserts = payloads.filter(p => !existingByName.has(String(p.name)));
          const updateResults = await Promise.all(updates.map(p =>
            admin.from("members").update({ job: p.job, power: p.power, ...(p.memo ? { memo: p.memo } : {}) }).eq("id", existingByName.get(String(p.name))!)
          ));
          const updateError = updateResults.find(r => r.error)?.error;
          const insertResult = inserts.length ? await admin.from("members").insert(inserts) : { error: null };
          if (updateError || insertResult.error) {
            syncError = `길드원 저장 실패: ${updateError?.message || insertResult.error?.message || result.error.message}`;
          }
        }
      }
    }
    if (syncError) {
      return NextResponse.json({
        ok: false,
        error: syncError,
        synced: 0,
        rows: members.length,
        sheet: { id: SHEET_ID, gid: SHEET_GID },
      }, { status: 500 });
    }
    const synced = members.length;

    return NextResponse.json({ ok: true, synced, rows: members.length, members, sheet: { id: SHEET_ID, gid: SHEET_GID }, columns: { name: headers[nameIdx] ?? "", job: jobIdx >= 0 ? headers[jobIdx] : "찾지 못함", power: headers[powerIdx] ?? "", memo: memoIdx >= 0 ? headers[memoIdx] : "없음" }, jobValues: [...new Set(members.map(m => m.job).filter(Boolean))].slice(0, 30), fetchedAt: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Google Sheets 동기화 실패" }, { status: 500 });
  }
}

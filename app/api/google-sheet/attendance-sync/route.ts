import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SHEET_ID = process.env.GOOGLE_SHEET_ID || "10TUvN2-5otNh22h8ABDT3bzek6anbUxeJhjodvBfQzE";
// '출석 기록' 탭의 GID (봇이 사용하는 출석 기록 시트)
const ATTENDANCE_SHEET_GID = process.env.GOOGLE_ATTENDANCE_SHEET_GID || "400265627";
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${ATTENDANCE_SHEET_GID}`;

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
  if (cell !== "" || row.length) {
    row.push(cell);
    if (row.some(v => v.trim() !== "")) rows.push(row);
  }
  return rows;
}

function normalizeHeader(value: string) {
  return value.replace(/^\uFEFF/, "").trim().replace(/[\s\u00A0_\-\/\\()\[\]{}:：·•]/g, "").toLowerCase();
}

function findHeader(headers: string[], names: string[], tokens: string[] = []) {
  const normalized = headers.map(normalizeHeader);
  const exact = names.map(n => normalized.indexOf(normalizeHeader(n))).find(i => i >= 0);
  if (exact !== undefined) return exact;
  return normalized.findIndex(h => tokens.some(t => h.includes(normalizeHeader(t))));
}

function parseDateTime(value: string): { date: string; time: string } | null {
  let v = value.trim();
  if (!v) return null;

  // Google Sheets may export dates differently depending on the sheet locale.
  // Support both ISO-like values and Korean locale values such as
  // "2026. 9. 24 오후 9:10:00" / "2026-09-24 21:10:00".
  v = v.replace(/\./g, "-").replace(/\s+/g, " ").trim();

  const m = v.match(/(\d{4})-(\d{1,2})-(\d{1,2})\s*(오전|오후|AM|PM)?\s*(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?/i);
  if (!m) return null;

  const [, y, mo, d, periodRaw, hhRaw, mmRaw = "00", ssRaw = "00"] = m;
  let hh = Number(hhRaw);
  const period = String(periodRaw || "").toLowerCase();
  if ((period === "오후" || period === "pm") && hh < 12) hh += 12;
  if ((period === "오전" || period === "am") && hh === 12) hh = 0;
  if (hh > 23 || Number(mmRaw) > 59 || Number(ssRaw) > 59) return null;

  return {
    date: `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`,
    time: `${String(hh).padStart(2, "0")}:${mmRaw.padStart(2, "0")}:${ssRaw.padStart(2, "0")}`,
  };
}

function weekOfMonth(date: string) {
  const day = Number(date.slice(8, 10));
  return Math.min(5, Math.max(1, Math.ceil(day / 7)));
}

function deterministicUuid(key: string) {
  const hex = createHash("sha1").update(`eclipse-google-attendance:${key}`).digest("hex").slice(0, 32).split("");
  // UUID v5-like deterministic ID. This avoids adding another DB column just for sheet sync.
  hex[12] = "5";
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20, 32).join("")}`;
}

export async function GET() {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      return NextResponse.json({ ok: false, error: "SUPABASE_SERVICE_ROLE_KEY 환경변수가 없습니다." }, { status: 500 });
    }

    const response = await fetch(CSV_URL, { cache: "no-store" });
    if (!response.ok) {
      return NextResponse.json({ ok: false, error: `Google Sheets 출석 기록 응답 오류: ${response.status}` }, { status: 502 });
    }
    const text = await response.text();
    if (!text || text.trim().startsWith("<!DOCTYPE") || text.includes("Sign in")) {
      return NextResponse.json({ ok: false, error: "출석 기록 시트를 공개 CSV로 읽을 수 없습니다. Google Sheets 공유 설정을 확인해주세요." }, { status: 403 });
    }

    const rows = parseCsv(text);
    if (rows.length < 2) return NextResponse.json({ ok: true, synced: 0, attendance: 0 });

    const headers = rows[0];
    const participantsIdx = findHeader(headers, ["참여 닉네임", "참여자", "닉네임"], ["참여닉네임", "참여자"]);
    const attendedIdx = findHeader(headers, ["참여 시간", "출석 시간"], ["참여시간", "출석시간"]);
    const bossIdx = findHeader(headers, ["보스명", "보스"], ["보스명"]);
    const scoreIdx = findHeader(headers, ["참여 점수", "점수"], ["참여점수"]);
    const spawnIdx = findHeader(headers, ["젠 시간", "젠시간"], ["젠시간"]);

    if (participantsIdx < 0 || bossIdx < 0 || spawnIdx < 0) {
      return NextResponse.json({
        ok: false,
        error: `출석 기록 시트 헤더를 찾지 못했습니다. 현재 헤더: ${headers.join(" / ")}`,
      }, { status: 400 });
    }

    const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
    let synced = 0;
    let attendanceSynced = 0;
    const errors: string[] = [];

    // 출석 기록 시트는 보통 "한 행 = 한 참여자" 구조입니다.
    // 같은 보스/젠 시간의 여러 행을 하나의 보스 기록으로 합쳐야
    // 마지막 참여자만 남는 문제가 생기지 않습니다.
    const bossGroups = new Map<string, {
      boss: string;
      spawnRaw: string;
      dt: { date: string; time: string };
      participants: string[];
      scoreValues: number[];
      attendedDates: string[];
    }>();

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const boss = String(r[bossIdx] ?? "").trim();
      const spawnRaw = String(r[spawnIdx] ?? "").trim();
      const participants = String(r[participantsIdx] ?? "")
        .split(",")
        .map(v => v.trim())
        .filter(Boolean);
      if (!boss || !spawnRaw || !participants.length) continue;

      const dt = parseDateTime(spawnRaw);
      if (!dt) {
        errors.push(`행 ${i + 1}: 젠 시간을 해석할 수 없습니다 (${spawnRaw})`);
        continue;
      }

      const attendedRaw = attendedIdx >= 0 ? String(r[attendedIdx] ?? "").trim() : "";
      const attendedDate = parseDateTime(attendedRaw)?.date || dt.date;
      const key = `${boss}|${spawnRaw}`;
      const group = bossGroups.get(key) || {
        boss, spawnRaw, dt, participants: [], scoreValues: [], attendedDates: [],
      };

      for (const name of participants) {
        if (!group.participants.includes(name)) group.participants.push(name);
      }
      if (attendedDate) group.attendedDates.push(attendedDate);

      const scoreRaw = scoreIdx >= 0 ? String(r[scoreIdx] ?? "").replace(/[,_\s]/g, "") : "";
      const rowScore = Number(scoreRaw);
      if (Number.isFinite(rowScore) && rowScore > 0) group.scoreValues.push(rowScore);
      bossGroups.set(key, group);
    }

    for (const group of bossGroups.values()) {
      const { boss, spawnRaw, dt, participants } = group;
      // 참여 점수가 행마다 반복되는 경우에는 중복 합산하지 않도록 최대값을 사용하고,
      // 값이 없으면 참여 인원 수를 기본 점수로 사용합니다.
      const score = group.scoreValues.length ? Math.max(...group.scoreValues) : participants.length;
      const id = deterministicUuid(`${boss}|${spawnRaw}`);
      const record = {
        id,
        week: weekOfMonth(dt.date),
        date: dt.date,
        boss,
        score,
        participants,
      };

      const { error } = await admin.from("boss_records").upsert(record, { onConflict: "id" });
      if (error) {
        errors.push(`${boss}: ${error.message}`);
        continue;
      }
      synced++;

      // 사이트의 'Discord 출석'도 시트에서 함께 채웁니다.
      // 같은 사람이 같은 날짜에 여러 보스에 참여해도 출석은 1회로 유지합니다.
      const attendedDates = [...new Set(group.attendedDates.length ? group.attendedDates : [dt.date])];
      for (const name of participants) {
        for (const attendedDate of attendedDates) {
          const { error: attendanceError } = await admin.from("attendance").upsert({
            member_name: name,
            discord_user_id: "",
            discord_display_name: name,
            attendance_date: attendedDate,
            status: "present",
            source: "google_sheet",
          }, { onConflict: "member_name,attendance_date" });
          if (!attendanceError) attendanceSynced++;
          else errors.push(`${name} ${attendedDate}: ${attendanceError.message}`);
        }
      }
    }

    return NextResponse.json({
      ok: errors.length === 0,
      synced,
      attendance: attendanceSynced,
      rows: rows.length - 1,
      errors: errors.slice(0, 20),
      sheet: { id: SHEET_ID, gid: ATTENDANCE_SHEET_GID },
      columns: {
        participants: participantsIdx >= 0 ? headers[participantsIdx] : "",
        attended: attendedIdx >= 0 ? headers[attendedIdx] : "",
        boss: headers[bossIdx] ?? "",
        spawn: headers[spawnIdx] ?? "",
      },
      fetchedAt: new Date().toISOString(),
    }, { status: errors.length ? 207 : 200 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "출석 기록 동기화 실패" }, { status: 500 });
  }
}

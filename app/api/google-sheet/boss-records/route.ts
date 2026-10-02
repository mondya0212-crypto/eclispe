import { NextResponse } from "next/server";
import { createHash } from "crypto";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const maxDuration = 15;

const SHEET_ID = process.env.GOOGLE_SHEET_ID || "10TUvN2-5otNh22h8ABDT3bzek6anbUxeJhjodvBfQzE";
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
  v = v.replace(/[.\/]/g, "-").replace(/년|월/g, "-").replace(/일/g, " ").replace(/\s+/g, " ").trim();

  let m = v.match(/(\d{4})-(\d{1,2})-(\d{1,2})\s*(오전|오후|AM|PM)?\s*(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?/i);
  if (!m) {
    const us = v.match(/(\d{1,2})-(\d{1,2})-(\d{4})\s*(오전|오후|AM|PM)?\s*(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?/i);
    if (us) m = [us[0], us[3], us[1], us[2], us[4], us[5], us[6], us[7]] as RegExpMatchArray;
  }
  if (!m) return null;
  const [, y, mo, d, periodRaw, hhRaw, mmRaw = "00", ssRaw = "00"] = m;
  let hh = Number(hhRaw);
  const period = String(periodRaw || "").toLowerCase();
  if ((period === "오후" || period === "pm") && hh < 12) hh += 12;
  if ((period === "오전" || period === "am") && hh === 12) hh = 0;
  if (hh > 23 || Number(mmRaw) > 59 || Number(ssRaw) > 59 || Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31) return null;
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
  const hex = createHash("sha1").update(`eclipse-google-sheet-boss:${key}`).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20, 32).join("")}`;
}

export async function GET() {
  try {
    const response = await fetch(`${CSV_URL}&_ts=${Date.now()}`, {
      cache: "no-store",
      next: { revalidate: 0 },
      headers: { "User-Agent": "ECLIPSE-Guild-Manager/1.0" },
    });
    if (!response.ok) {
      return NextResponse.json({ ok: false, error: `Google Sheets 응답 오류: ${response.status}` }, { status: 502 });
    }
    const text = await response.text();
    if (!text || text.trim().startsWith("<!DOCTYPE") || text.includes("Sign in")) {
      return NextResponse.json({ ok: false, error: "Google Sheets를 공개 CSV로 읽을 수 없습니다. 해당 시트를 웹에 게시하거나 공개 읽기 설정을 확인해주세요." }, { status: 403 });
    }

    const rows = parseCsv(text);
    if (rows.length < 2) return NextResponse.json({ ok: true, records: [], rows: 0, sheet: { id: SHEET_ID, gid: ATTENDANCE_SHEET_GID } });

    const headers = rows[0];
    const participantsIdx = findHeader(headers, ["참여 닉네임", "참여자", "닉네임"], ["참여닉네임", "참여자"]);
    const attendedIdx = findHeader(headers, ["참여 시간", "출석 시간"], ["참여시간", "출석시간"]);
    const bossIdx = findHeader(headers, ["보스명", "보스"], ["보스명"]);
    const totalIdx = findHeader(headers, ["총인원", "인원"], ["총인원"]);
    const scoreIdx = findHeader(headers, ["참여 점수", "점수"], ["참여점수"]);
    const spawnIdx = findHeader(headers, ["젠 시간", "젠시간"], ["젠시간"]);

    if (participantsIdx < 0 || bossIdx < 0 || spawnIdx < 0) {
      return NextResponse.json({
        ok: false,
        error: `보스 참여 기록에 필요한 헤더를 찾지 못했습니다. 현재 헤더: ${headers.join(" / ")}`,
      }, { status: 400 });
    }

    const groups = new Map<string, {
      boss: string; date: string; spawn_time: string; participants: string[]; scoreValues: number[]; totalValues: number[];
      attendanceTimes: string[];
    }>();

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const boss = String(r[bossIdx] ?? "").trim();
      const spawnRaw = String(r[spawnIdx] ?? "").trim();
      const participants = String(r[participantsIdx] ?? "")
        .split(/[,\n\r;|\/、]+/)
        .map(v => v.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .filter((name, idx, arr) => arr.indexOf(name) === idx);
      if (!boss || !spawnRaw || !participants.length) continue;
      const dt = parseDateTime(spawnRaw);
      if (!dt) continue;

      const key = `${boss}|${dt.date}|${dt.time}`;
      const group = groups.get(key) || {
        boss, date: dt.date, spawn_time: dt.time, participants: [], scoreValues: [], totalValues: [], attendanceTimes: [],
      };
      for (const name of participants) if (!group.participants.includes(name)) group.participants.push(name);

      if (attendedIdx >= 0) {
        const attended = String(r[attendedIdx] ?? "").trim();
        if (attended) group.attendanceTimes.push(attended);
      }
      if (scoreIdx >= 0) {
        const n = Number(String(r[scoreIdx] ?? "").replace(/[,_\s]/g, ""));
        if (Number.isFinite(n) && n > 0) group.scoreValues.push(n);
      }
      if (totalIdx >= 0) {
        const n = Number(String(r[totalIdx] ?? "").replace(/[,_\s]/g, ""));
        if (Number.isFinite(n) && n > 0) group.totalValues.push(n);
      }
      groups.set(key, group);
    }

    const records = [...groups.values()].map(group => ({
      id: deterministicUuid(`${group.boss}|${group.date}|${group.spawn_time}`),
      week: weekOfMonth(group.date),
      date: group.date,
      boss: group.boss,
      score: group.scoreValues.length ? Math.max(...group.scoreValues) : group.participants.length,
      participants: group.participants,
      spawn_time: group.spawn_time,
      total_count: group.totalValues.length ? Math.max(...group.totalValues) : group.participants.length,
      attendance_times: group.attendanceTimes,
      source: "google_sheet",
    }));

    records.sort((a, b) => `${b.date} ${b.spawn_time}`.localeCompare(`${a.date} ${a.spawn_time}`));

    return NextResponse.json({
      ok: true,
      records,
      rows: rows.length - 1,
      fetchedAt: new Date().toISOString(),
      sheet: { id: SHEET_ID, gid: ATTENDANCE_SHEET_GID },
      columns: { participants: headers[participantsIdx], attended: attendedIdx >= 0 ? headers[attendedIdx] : "", boss: headers[bossIdx], total: totalIdx >= 0 ? headers[totalIdx] : "", score: scoreIdx >= 0 ? headers[scoreIdx] : "", spawn: headers[spawnIdx] },
    }, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Google Sheets 보스 기록을 불러오지 못했습니다." }, { status: 500 });
  }
}

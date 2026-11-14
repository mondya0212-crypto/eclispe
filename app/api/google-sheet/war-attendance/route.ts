import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const SHEET_ID = process.env.GOOGLE_SHEET_ID || "10TUvN2-5otNh22h8ABDT3bzek6anbUxeJhjodvBfQzE";
const WAR_ATTENDANCE_GID = process.env.GOOGLE_WAR_ATTENDANCE_SHEET_GID || "991539041";
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${WAR_ATTENDANCE_GID}`;

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    if (ch === '"') {
      if (quoted && next === '"') { cell += '"'; i++; } else quoted = !quoted;
    } else if (ch === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && next === "\n") i++;
      row.push(cell); cell = "";
      if (row.some(v => v.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); if (row.some(v => v.trim())) rows.push(row); }
  return rows;
}

function parseDate(value: string) {
  const v = String(value || "").trim();
  if (!v) return { date: "", time: "" };
  const m = v.match(/(\d{4})[-./]\s*(\d{1,2})[-./]\s*(\d{1,2})\s*(오전|오후|AM|PM)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/i);
  if (m) {
    let hour = Number(m[5]);
    const period = (m[4] || "").toLowerCase();
    if ((period === "오후" || period === "pm") && hour < 12) hour += 12;
    if ((period === "오전" || period === "am") && hour === 12) hour = 0;
    return {
      date: `${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`,
      time: `${String(hour).padStart(2,"0")}:${m[6]}:${m[7] || "00"}`,
    };
  }
  const d = new Date(v);
  if (!Number.isNaN(d.getTime())) return {
    date: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`,
    time: `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}`,
  };
  return { date: v, time: "" };
}

export async function GET() {
  try {
    const response = await fetch(`${CSV_URL}&_ts=${Date.now()}`, { cache: "no-store", next: { revalidate: 0 } });
    if (!response.ok) return NextResponse.json({ ok: false, error: `쟁 출석 시트 응답 오류: ${response.status}` }, { status: 502 });
    const csv = await response.text();
    if (!csv || csv.trim().startsWith("<!DOCTYPE") || csv.includes("Sign in")) {
      return NextResponse.json({ ok: false, error: "쟁 출석 시트를 CSV로 읽을 수 없습니다. 해당 탭을 웹에 게시하거나 공개 읽기 설정을 확인해주세요." }, { status: 403 });
    }
    const rows = parseCsv(csv);
    if (!rows.length) return NextResponse.json({ ok: true, records: [], rows: 0, sheet: { id: SHEET_ID, gid: WAR_ATTENDANCE_GID } });
    const headers = rows[0].map(v => v.replace(/^\uFEFF/, "").trim());
    const indexes = { nickname: headers.indexOf("참여 닉네임"), attendedAt: headers.indexOf("참여 시간"), category: headers.indexOf("구분"), totalCount: headers.indexOf("총인원"), score: headers.indexOf("참여 점수"), warStartAt: headers.indexOf("쟁 시작 시간") };
    if (indexes.nickname < 0) return NextResponse.json({ ok: false, error: `참여 닉네임 열을 찾지 못했습니다. 현재 헤더: ${headers.join(" / ")}` }, { status: 400 });
    const records = rows.slice(1).map((r, i) => {
      const attendedRaw = r[indexes.attendedAt] || "";
      const warRaw = r[indexes.warStartAt] || "";
      const attended = parseDate(attendedRaw);
      const warStart = parseDate(warRaw);
      const score = Number(String(r[indexes.score] || "").replace(/[,_\s]/g, ""));
      const total = Number(String(r[indexes.totalCount] || "").replace(/[,_\s]/g, ""));
      return {
        id: `war-${i + 2}`,
        nickname: String(r[indexes.nickname] || "").trim(),
        attendedAt: attendedRaw,
        attendedDate: attended.date,
        attendedTime: attended.time,
        category: String(r[indexes.category] || "").trim(),
        totalCount: Number.isFinite(total) ? total : 0,
        score: Number.isFinite(score) ? score : 0,
        warStartAt: warRaw,
        warStartDate: warStart.date,
        warStartTime: warStart.time,
        sheetRow: i + 2,
      };
    }).filter(r => r.nickname);
    records.sort((a, b) => `${b.warStartAt} ${b.attendedAt}`.localeCompare(`${a.warStartAt} ${a.attendedAt}`));
    return NextResponse.json({ ok: true, records, rows: rows.length - 1, fetchedAt: new Date().toISOString(), sheet: { id: SHEET_ID, gid: WAR_ATTENDANCE_GID }, columns: headers }, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "쟁 출석 기록을 불러오지 못했습니다." }, { status: 500 });
  }
}

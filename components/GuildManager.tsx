"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays, ChevronDown, Dices, LayoutDashboard, Lock, Menu, Pencil, Plus,
  RefreshCw, Search, Swords, Trash2, Trophy, Users, Wallet, X, FileSpreadsheet,
} from "lucide-react";
import { supabase } from "../lib/supabase";

type Member = {
  id: string; name: string; job: string; power: number; defense?: number; accuracy?: number;
  created_at?: string; memo?: string | null;
};
type BossRecord = { id: string; week: number; date: string; boss: string; score: number; participants: string[]; spawn_time?: string | null };
type DistributionRecord = { id: string; date: string; recipient: string; amount: number; reason: string; memo?: string | null };
type AdminMemo = { id: string; title: string; content: string; created_at: string; updated_at: string };
type Attendance = { id: string; member_name: string; discord_user_id?: string | null; discord_display_name?: string | null; attendance_date: string; status: string; source: string; created_at: string };
type AppData = { members: Member[]; records: BossRecord[]; distributions: DistributionRecord[]; memos: AdminMemo[]; attendance: Attendance[] };

type MenuKey = "dashboard" | "members" | "boss" | "distribution" | "stats" | "memo" | "ladder";
const menus: { key: MenuKey; label: string; icon: typeof Users }[] = [
  { key: "dashboard", label: "대시보드", icon: LayoutDashboard },
  { key: "members", label: "길드원 목록", icon: Users },
  { key: "boss", label: "보스 참여 기록", icon: Swords },
  { key: "distribution", label: "분배금 내역", icon: Wallet },
  { key: "stats", label: "참여율 기록", icon: CalendarDays },
  { key: "memo", label: "관리자 메모", icon: Pencil },
  { key: "ladder", label: "사다리 게임", icon: Dices },
];

const ADMIN_PASSWORD = process.env.NEXT_PUBLIC_ADMIN_PASSWORD || "0910";

function requireAdmin(): boolean {
  const password = window.prompt("관리자 비밀번호를 입력해주세요.");
  if (password === null) return false;
  if (password !== ADMIN_PASSWORD) {
    window.alert("관리자 비밀번호가 올바르지 않습니다.");
    return false;
  }
  return true;
}

function formatNumber(value: number) { return Number(value || 0).toLocaleString("ko-KR"); }

// 보스 젠 시간은 날짜와 무관하게 시간만 표시합니다.\n// 시트 동기화 값(YYYY-MM-DD HH:mm[:ss])과 기존 datetime-local 값 모두 처리합니다.
function formatSpawnTime(value?: string | null) {
  const v = String(value ?? "").trim().replace(/\u00a0/g, " ").replace(/\s+/g, " ");
  if (!v || v === "-" || v === "—") return "-";

  // YYYY-MM-DD HH:mm[:ss], YYYY. M. D. 오후 9:10:30, YYYY년 M월 D일 오후 9시 10분 30초 등
  let m = v.match(/(?:^|T|\s)(?:오전|오후|AM|PM)?\s*(\d{1,2})\s*(?::|시)\s*(\d{1,2})(?:\s*분)?(?:\s*[:초]\s*(\d{1,2})\s*초?)?/i);
  if (m) {
    let h = Number(m[1]);
    const period = (v.match(/(?:^|\s)(오전|오후|AM|PM)\s*\d/i)?.[1] || "").toLowerCase();
    if ((period === "오후" || period === "pm") && h < 12) h += 12;
    if ((period === "오전" || period === "am") && h === 12) h = 0;
    const mm = Number(m[2]);
    const ss = Number(m[3] || 0);
    if (h <= 23 && mm <= 59 && ss <= 59) return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  }

  // 시간만 있는 값: 21:10:30 / 오후 9:10:30 / 오후 9시 10분 30초 / 21시10분30초
  m = v.match(/^(오전|오후|AM|PM)?\s*(\d{1,2})\s*(?::|시)\s*(\d{1,2})(?:\s*분)?(?:\s*[:초]\s*(\d{1,2})\s*초?)?$/i);
  if (m) {
    let h = Number(m[2]);
    const period = (m[1] || "").toLowerCase();
    if ((period === "오후" || period === "pm") && h < 12) h += 12;
    if ((period === "오전" || period === "am") && h === 12) h = 0;
    return `${String(h).padStart(2, "0")}:${String(m[3]).padStart(2, "0")}:${String(m[4] || 0).padStart(2, "0")}`;
  }

  // 숫자형 Google Sheets 날짜/시간 serial이 이미 DB에 들어간 경우에도 표시
  if (/^\d+(?:\.\d+)?$/.test(v)) {
    const n = Number(v);
    if (n >= 0 && n < 1) {
      const total = Math.round(n * 86400) % 86400;
      return `${String(Math.floor(total / 3600)).padStart(2, "0")}:${String(Math.floor((total % 3600) / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
    }
  }
  return v;
}

function uniqueBossRecords(records: BossRecord[]) {
  // 같은 날짜/보스라도 젠 시간이 다르면 서로 다른 보스 기록입니다.
  // 기존 코드는 참여자 목록만으로 중복 제거해서,
  // 젠 시간이 정상적으로 들어온 시트 기록이 기존 '-' 기록에 가려질 수 있었습니다.
  // 이제 날짜 + 보스 + 젠 시간을 기준으로만 중복 제거합니다.
  const seen = new Set<string>();
  return records.filter(r => {
    const spawn = String(r.spawn_time ?? "").trim();
    const key = `${r.date}|${r.boss.trim()}|${spawn}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function totalPower(m: Member) { return Number(m.power) || 0; }

export default function GuildManager() {
  const [active, setActive] = useState<MenuKey>("dashboard");
  const [sidebar, setSidebar] = useState(true);
  const [data, setData] = useState<AppData>({ members: [], records: [], distributions: [], memos: [], attendance: [] });
  const [loading, setLoading] = useState(true);

  // 자동 동기화가 겹치지 않도록 잠금합니다.
  const syncInProgressRef = useRef(false);
  const refreshInProgressRef = useRef(false);

  const fetchWithTimeout = async (url: string, timeoutMs = 15000) => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { cache: "no-store", signal: controller.signal });
    } finally {
      window.clearTimeout(timer);
    }
  };

  const syncSheetsSilently = async () => {
    // 이전 자동 동기화가 아직 진행 중이면 새 요청을 만들지 않습니다.
    if (syncInProgressRef.current) return false;
    syncInProgressRef.current = true;

    try {
      // 두 API를 동시에 호출하지 않고 순차 처리합니다.
      // 길드원 동기화가 끝난 뒤 출석 기록을 동기화합니다.
      const memberResponse = await fetchWithTimeout("/api/google-sheet/sync");
      const memberResult = await memberResponse.json().catch(() => null);

      if (!memberResponse.ok || !memberResult?.ok) {
        console.warn("Google Sheets 길드원 명단 자동 동기화 실패:", memberResult?.error || memberResponse.status);
        return false;
      }

      const attendanceResponse = await fetchWithTimeout("/api/google-sheet/attendance-sync");
      const attendanceResult = await attendanceResponse.json().catch(() => null);

      if (!attendanceResponse.ok || !attendanceResult) {
        console.warn("Google Sheets 출석 기록 자동 동기화 실패:", attendanceResult?.error || attendanceResponse.status);
        return false;
      }

      // 보스 기록이 반영된 경우 출석 일부 오류가 있어도 반드시 최신 DB를 다시 읽습니다.
      // 이전에는 attendance 오류 하나 때문에 화면 갱신 자체가 건너뛰어
      // 이미 Supabase에 들어간 젠 시간이 화면에 늦게 나타날 수 있었습니다.
      return Number(attendanceResult?.synced ?? 0) >= 0;
    } catch (error) {
      // 자동 동기화 오류는 사용자 화면에 띄우지 않고 콘솔에만 기록합니다.
      const message = error instanceof DOMException && error.name === "AbortError"
        ? "동기화 요청 시간 초과"
        : error instanceof Error ? error.message : "네트워크 오류";
      console.warn("Google Sheets 자동 동기화 실패:", message);
      return false;
    } finally {
      syncInProgressRef.current = false;
    }
  };

  const refreshDataSilently = async () => {
    if (refreshInProgressRef.current) return;
    refreshInProgressRef.current = true;
    try {
    const [membersResult, recordsResult, distributionsResult, memosResult, attendanceResult] = await Promise.all([
      supabase.from("members").select("*").order("name"),
      supabase.from("boss_records").select("*").order("date", { ascending: false }).limit(5000),
      supabase.from("distribution_records").select("*").order("date", { ascending: false }),
      supabase.from("admin_memos").select("*").order("created_at", { ascending: false }),
      supabase.from("attendance").select("*").order("attendance_date", { ascending: false }),
    ]);

    // 백그라운드 갱신에서는 loading=true를 절대 건드리지 않습니다.
    // 현재 화면은 그대로 두고, 데이터만 교체합니다.
    setData({
      members: (membersResult.data || []) as Member[],
      records: uniqueBossRecords((recordsResult.data || []) as BossRecord[]),
      distributions: (distributionsResult.data || []) as DistributionRecord[],
      memos: (memosResult.data || []) as AdminMemo[],
      attendance: (attendanceResult.data || []) as Attendance[],
    });
    } finally {
      refreshInProgressRef.current = false;
    }
  };

  const load = async (syncSheet = false) => {
    setLoading(true);
    // 수동 시트 동기화는 길드원 정보 + 출석/보스 기록을 한 번에 반영합니다.
    if (syncSheet) {
      try {
        const [memberResponse, attendanceResponse] = await Promise.all([
          fetch("/api/google-sheet/sync", { cache: "no-store" }),
          fetch("/api/google-sheet/attendance-sync", { cache: "no-store" }),
        ]);
        const memberResult = await memberResponse.json().catch(() => null);
        const attendanceResult = await attendanceResponse.json().catch(() => null);
        if (!memberResponse.ok || !memberResult?.ok) {
          window.alert(`❌ Google Sheets 길드원 동기화 실패\n\n${memberResult?.error || `서버 오류 (${memberResponse.status})`}`);
        } else if (!attendanceResponse.ok || !attendanceResult?.ok) {
          window.alert(`⚠️ 길드원 동기화는 완료됐지만 출석 기록 동기화에 문제가 있습니다.\n\n길드원: ${memberResult.synced ?? 0}명\n출석/보스 오류: ${attendanceResult?.error || `서버 오류 (${attendanceResponse.status})`}`);
        } else {
          window.alert(`✅ Google Sheets 전체 동기화 완료\n\n길드원: ${memberResult.synced ?? 0}명\n보스 출석 기록: ${attendanceResult.synced ?? 0}건\n출석 반영: ${attendanceResult.attendance ?? 0}건\n\n직업 열: ${memberResult.columns?.job || "찾지 못함"}`);
        }
      } catch (error) {
        window.alert(`❌ Google Sheets 연동 실패\n\n${error instanceof Error ? error.message : "네트워크 오류"}`);
      }
    }
    const [{ data: members, error: membersError }, { data: records, error: recordsError }, { data: distributions, error: distributionError }, { data: memos, error: memosError }, { data: attendance, error: attendanceError }] = await Promise.all([
      supabase.from("members").select("*").order("name"),
      supabase.from("boss_records").select("*").order("date", { ascending: false }).limit(5000),
      supabase.from("distribution_records").select("*").order("date", { ascending: false }),
      supabase.from("admin_memos").select("*").order("created_at", { ascending: false }),
      supabase.from("attendance").select("*").order("attendance_date", { ascending: false }),
    ]);
    if (membersError || recordsError || distributionError || memosError || attendanceError) {
      window.alert(membersError?.message || recordsError?.message || distributionError?.message || memosError?.message || attendanceError?.message || "데이터를 불러오지 못했습니다.");
    }
    setData({
      members: (members || []) as Member[],
      records: uniqueBossRecords((records || []) as BossRecord[]),
      distributions: (distributions || []) as DistributionRecord[],
      memos: (memos || []) as AdminMemo[],
      attendance: (attendance || []) as Attendance[],
    });
    setLoading(false);
  };

  useEffect(() => {
    // 최초 데이터 로딩 후, Google Sheets의 길드원 명단과 출석 기록을
    // 30초마다 화면 깜빡임 없이 백그라운드에서 조용히 동기화합니다.
    let stopped = false;
    let timer: number | undefined;

    // 한 번의 동기화가 끝난 뒤 30초를 기다립니다.
    // setInterval로 고정 주기를 돌리지 않아 동기화 요청이 겹치지 않습니다.
    const runBackgroundSync = async () => {
      if (stopped) return;
      const synced = await syncSheetsSilently();
      if (stopped) return;
      // 시트가 성공했든 실패했든 화면 데이터는 조용히 확인합니다.
      if (synced) await refreshDataSilently();
      if (!stopped) timer = window.setTimeout(() => { void runBackgroundSync(); }, 30000);
    };

    // 첫 화면은 Supabase 데이터만 즉시 읽어 띄우고, 시트 동기화는 화면 뒤에서 시작합니다.
    void (async () => {
      await refreshDataSilently();
      if (!stopped) setLoading(false);
      void runBackgroundSync();
    })();

    const channel = supabase.channel("guild-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "members" }, () => { void refreshDataSilently(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "boss_records" }, () => { void refreshDataSilently(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "distribution_records" }, () => { void refreshDataSilently(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "admin_memos" }, () => { void refreshDataSilently(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "attendance" }, () => { void refreshDataSilently(); })
      .subscribe();
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, []);

  const title = menus.find(m => m.key === active)?.label || "대시보드";
  return <div className="app">
    <aside className={`sidebar ${sidebar ? "open" : "closed"}`}>
      <div className="brand">
        <div className="brand-mark">🐇</div>
        <div><strong>ECLIPSE</strong><span>GUILD MANAGER</span></div>
        <button className="icon-btn mobile-only" onClick={() => setSidebar(false)}><X size={19} /></button>
      </div>
      <nav>{menus.map(({ key, label, icon: Icon }) => <button key={key} className={`nav-item ${active === key ? "active" : ""}`} onClick={() => { setActive(key); if (window.innerWidth <= 900) setSidebar(false); }}><Icon size={18} /><span>{label}</span></button>)}</nav>
      <div className="side-foot">ECLIPSE GUILD MANAGER</div>
    </aside>

    <main className="main">
      <header className="topbar">
        <button className="icon-btn menu-toggle" onClick={() => setSidebar(!sidebar)}><Menu size={20} /></button>
        <div><div className="crumb">ECLIPSE GUILD / {title}</div><h1>{title}</h1></div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}><button className="secondary" onClick={() => void load(true)} title="Google Sheets 전체 동기화"><FileSpreadsheet size={15} /> 시트 동기화</button><button className="refresh" onClick={() => void load(false)} title="데이터 새로고침"><RefreshCw size={16} /></button></div>
      </header>
      <section className="content">
        {loading ? <div className="loading-page"><div className="loading-dot" /> 데이터를 불러오는 중...</div> : <>
          {active === "dashboard" && <Dashboard data={data} />}
          {active === "members" && <Members data={data} setData={setData} />}
          {active === "boss" && <BossRecords data={data} setData={setData} />}
          {active === "distribution" && <Distribution data={data} setData={setData} />}
          {active === "stats" && <Stats data={data} />}
          {active === "memo" && <MemoManager data={data} setData={setData} />}
          {active === "ladder" && <Ladder members={data.members} />}
        </>}
      </section>
    </main>
  </div>;
}

function PageIntro({ title, desc, badge }: { title: string; desc: string; badge?: string }) {
  return <div className="page-head"><div><div className="eyebrow">ECLIPSE GUILD {badge && <span className="eyebrow-badge">{badge}</span>}</div><h2>{title}</h2><p>{desc}</p></div></div>;
}
function Empty({ text }: { text: string }) { return <div className="empty">{text}</div>; }
function StatCard({ icon, label, value, accent = "purple" }: { icon: React.ReactNode; label: string; value: string; accent?: string }) {
  return <div className={`stat-card ${accent}`}><div className="stat-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong></div></div>;
}

function Dashboard({ data }: { data: AppData }) {
  const avgPower = data.members.length ? Math.round(data.members.reduce((sum, m) => sum + totalPower(m), 0) / data.members.length) : 0;
  const guildPower = data.members.reduce((sum, m) => sum + totalPower(m), 0);
  const totalParticipation = data.records.length;
  const totalDistribution = data.distributions.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  return <div className="stack">
    <PageIntro title="🌷 길드 대시보드" desc="길드 현황과 주요 기록을 한눈에 확인할 수 있습니다." />
    <div className="cards cards-3">
      <StatCard icon={<Users />} label="총 길드원" value={`${data.members.length}명`} />
      <StatCard icon={<Trophy />} label="길드 총 투력" value={formatNumber(guildPower)} accent="pink" />
      <StatCard icon={<Swords />} label="평균 투력" value={formatNumber(avgPower)} accent="rose" />
    </div>
    <div className="grid-2">
      <div className="panel"><div className="panel-title"><span>⚔️ 최근 보스 기록</span><span className="muted">총 {data.records.length}건</span></div>
        {data.records.length ? <div className="table-wrap"><table className="dashboard-table"><thead><tr><th>날짜</th><th>보스</th><th>점수</th><th>참여</th></tr></thead><tbody>{data.records.slice(0, 7).map(r => <tr key={r.id}><td>{r.date}</td><td className="strong">{r.boss}</td><td>{formatNumber(r.score)}</td><td>{r.participants?.length || 0}명</td></tr>)}</tbody></table></div> : <Empty text="등록된 보스 기록이 없습니다." />}
      </div>
      <div className="panel"><div className="panel-title"><span>💰 분배금 현황</span><b>{formatNumber(totalDistribution)} D</b></div><div className="soft-summary"><span>누적 보스 횟수</span><strong>{totalParticipation}회</strong></div>{data.distributions.length ? <div className="simple-list">{data.distributions.slice(0, 5).map(r => <div key={r.id}><span>{r.recipient}</span><b>{formatNumber(r.amount)} D</b></div>)}</div> : <Empty text="등록된 분배금 내역이 없습니다." />}</div>
    </div>
  </div>;
}

function Members({ data, setData }: { data: AppData; setData: React.Dispatch<React.SetStateAction<AppData>> }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"high" | "low" | "name">("high");
  const [editing, setEditing] = useState<Member | null>(null);
  const [form, setForm] = useState({ name: "", job: "", power: "", memo: "" });
  const [saving, setSaving] = useState(false);
  const [memoEditingId, setMemoEditingId] = useState<string | null>(null);
  const [memoDraft, setMemoDraft] = useState("");
  const [memoSaving, setMemoSaving] = useState(false);

  const list = useMemo(() => data.members.filter(m => `${m.name} ${m.job}`.toLowerCase().includes(q.trim().toLowerCase())).sort((a, b) => {
    if (sort === "high") return totalPower(b) - totalPower(a);
    if (sort === "low") return totalPower(a) - totalPower(b);
    return a.name.localeCompare(b.name, "ko");
  }), [data.members, q, sort]);

  const reset = () => { setEditing(null); setForm({ name: "", job: "", power: "", memo: "" }); };

  // 신규 길드원 등록은 비밀번호 없이 누구나 가능
  const addMember = async () => {
    if (!form.name.trim()) return window.alert("닉네임을 입력해주세요.");
    setSaving(true);
    const row = { name: form.name.trim(), job: form.job.trim(), power: Number(form.power) || 0, memo: form.memo.trim() };
    const result = await supabase.from("members").insert(row).select().single();
    setSaving(false);
    if (result.error) return window.alert(`등록 실패: ${result.error.message}`);
    setData(d => ({ ...d, members: [...d.members, result.data as Member] }));
    reset();
  };

  const startEdit = (m: Member) => {
    if (!requireAdmin()) return;
    setEditing(m);
    setForm({ name: m.name, job: m.job || "", power: String(m.power || 0), memo: m.memo || "" });
  };

  // 길드원 메모는 별도 인라인 편집: 비밀번호 없이 바로 저장
  const startMemoEdit = (m: Member) => {
    setMemoEditingId(m.id);
    setMemoDraft(m.memo || "");
  };

  const cancelMemoEdit = () => {
    setMemoEditingId(null);
    setMemoDraft("");
  };

  const saveMemberMemo = async (m: Member) => {
    setMemoSaving(true);
    const result = await supabase.from("members").update({ memo: memoDraft.trim() }).eq("id", m.id).select().single();
    setMemoSaving(false);
    if (result.error) return window.alert(`메모 저장 실패: ${result.error.message}`);
    setData(d => ({ ...d, members: d.members.map(member => member.id === m.id ? result.data as Member : member) }));
    cancelMemoEdit();
  };

  const updateMember = async () => {
    if (!editing) return;
    if (!form.name.trim()) return window.alert("닉네임을 입력해주세요.");
    if (!requireAdmin()) return;
    setSaving(true);
    const row = { name: form.name.trim(), job: form.job.trim(), power: Number(form.power) || 0, memo: form.memo.trim() };
    const result = await supabase.from("members").update(row).eq("id", editing.id).select().single();
    setSaving(false);
    if (result.error) return window.alert(`수정 실패: ${result.error.message}`);
    setData(d => ({ ...d, members: d.members.map(m => m.id === editing.id ? result.data as Member : m) }));
    reset();
  };

  const del = async (id: string) => {
    if (!requireAdmin()) return;
    const member = data.members.find(m => m.id === id); if (!member) return;
    if (!window.confirm(`"${member.name}" 길드원을 삭제할까요?`)) return;
    const { error } = await supabase.from("members").delete().eq("id", id);
    if (error) return window.alert(`삭제 실패: ${error.message}`);
    setData(d => ({ ...d, members: d.members.filter(m => m.id !== id), records: d.records.map(r => ({ ...r, participants: (r.participants || []).filter(n => n !== member.name) })) }));
  };

  return <div className="stack">
    <PageIntro title="👥 길드원 목록" desc="길드원 정보를 카드형 UI로 확인하고 투력 기준으로 정렬할 수 있습니다." />
    <div className="panel add-member-panel">
      <div className="panel-title"><span>➕ 길드원 등록 <small className="free-register-badge">비밀번호 없이 등록 가능</small></span></div>
      <div className="form-grid member-add-grid">
        <input placeholder="닉네임" value={editing ? "" : form.name} onChange={e => !editing && setForm({ ...form, name: e.target.value })} disabled={!!editing} />
        <input placeholder="직업" value={editing ? "" : form.job} onChange={e => !editing && setForm({ ...form, job: e.target.value })} disabled={!!editing} />
        <input type="number" placeholder="투력" value={editing ? "" : form.power} onChange={e => !editing && setForm({ ...form, power: e.target.value })} disabled={!!editing} />
        <button className="primary" disabled={saving || !!editing} onClick={addMember}><Plus size={16} /> {saving ? "등록 중..." : "등록"}</button>
      </div>
    </div>

    {editing && <div className="panel edit-member-banner">
      <div><strong>✏️ {editing.name} 길드원 수정</strong><span>수정은 관리자 비밀번호가 필요합니다.</span></div>
      <div className="edit-member-actions"><button className="secondary" onClick={reset}>취소</button><button className="primary" disabled={saving} onClick={updateMember}>{saving ? "저장 중..." : "수정 저장"}</button></div>
    </div>}

    {editing && <div className="panel member-edit-form">
      <div className="form-grid member-add-grid">
        <input placeholder="닉네임" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
        <input placeholder="직업" value={form.job} onChange={e => setForm({ ...form, job: e.target.value })} />
        <input type="number" placeholder="투력" value={form.power} onChange={e => setForm({ ...form, power: e.target.value })} />
        <textarea className="member-memo-input" placeholder="길드원 메모" value={form.memo} onChange={e => setForm({ ...form, memo: e.target.value })} />
      </div>
    </div>}

    <div className="members-toolbar">
      <div className="search member-search"><Search size={17} /><input placeholder="닉네임 또는 직업 검색" value={q} onChange={e => setQ(e.target.value)} /></div>
      <div className="toolbar-right"><span className="muted">검색 {list.length}명 / 전체 {data.members.length}명</span><label className="sort-select"><span>정렬</span><select value={sort} onChange={e => setSort(e.target.value as typeof sort)}><option value="high">높은 투력순</option><option value="low">낮은 투력순</option><option value="name">닉네임순</option></select><ChevronDown size={15} /></label></div>
    </div>

    <div className="member-grid">
      {list.map(m => <div className="member-card-v2" key={m.id}>
        <div className="member-avatar">🐰</div>
        <div className="member-main">
          <div className="member-top"><div><strong>{m.name}</strong><span className="job-pill">{m.job || "직업 미등록"}</span></div><div className="actions"><button title="메모 추가/수정" className="memo-action" onClick={() => startMemoEdit(m)}>📝</button><button title="수정" onClick={() => startEdit(m)}><Pencil size={14} /></button><button title="삭제" className="danger" onClick={() => del(m.id)}><Trash2 size={14} /></button></div></div>
          <div className="total-power member-power-display"><span>⭐ 투력</span><strong>{formatNumber(totalPower(m))}</strong></div>
          {memoEditingId === m.id ? (
            <div className="member-inline-memo">
              <div className="member-inline-memo-title">📝 길드원 메모 <span>비밀번호 없이 수정 가능</span></div>
              <textarea value={memoDraft} onChange={e => setMemoDraft(e.target.value)} placeholder="이 길드원에게 남길 메모를 입력하세요." autoFocus />
              <div className="member-inline-memo-actions"><button className="secondary small" onClick={cancelMemoEdit}>취소</button><button className="primary small" disabled={memoSaving} onClick={() => saveMemberMemo(m)}>{memoSaving ? "저장 중..." : "메모 저장"}</button></div>
            </div>
          ) : (
            <button className="member-memo-preview member-memo-preview-button" onClick={() => startMemoEdit(m)}>📝 {m.memo || "메모 추가하기"}</button>
          )}
        </div>
      </div>)}
    </div>
    {!list.length && <div className="panel"><Empty text={q ? "검색 결과가 없습니다." : "등록된 길드원이 없습니다."} /></div>}
  </div>;
}

function BossRecords({ data, setData }: { data: AppData; setData: React.Dispatch<React.SetStateAction<AppData>> }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [boss, setBoss] = useState(""); const [spawnTime, setSpawnTime] = useState(""); const [score, setScore] = useState(""); const [selected, setSelected] = useState<string[]>([]); const [editing, setEditing] = useState<BossRecord | null>(null); const [saving, setSaving] = useState(false);
  const resetEdit = () => { setEditing(null); setDate(new Date().toISOString().slice(0, 10)); setBoss(""); setSpawnTime(""); setScore(""); setSelected([]); };
  const add = async () => { if (!boss.trim()) return window.alert("보스명을 입력해주세요."); setSaving(true); const { data: record, error } = await supabase.from("boss_records").insert({ date, boss: boss.trim(), spawn_time: spawnTime || null, score: Number(score) || 0, participants: selected }).select().single(); setSaving(false); if (error) return window.alert(error.message); setData(d => ({ ...d, records: [record as BossRecord, ...d.records] })); setBoss(""); setScore(""); setSelected([]); };
  const startEdit = (r: BossRecord) => { if (!requireAdmin()) return; setEditing(r); setDate(r.date); setBoss(r.boss); setSpawnTime(r.spawn_time || ""); setScore(String(r.score)); setSelected(r.participants || []); };
  const saveEdit = async () => { if (!editing) return; if (!boss.trim()) return window.alert("보스명을 입력해주세요."); setSaving(true); const { data: record, error } = await supabase.from("boss_records").update({ date, boss: boss.trim(), spawn_time: spawnTime || null, score: Number(score) || 0, participants: selected }).eq("id", editing.id).select().single(); setSaving(false); if (error) return window.alert(`수정 실패: ${error.message}`); setData(d => ({ ...d, records: d.records.map(r => r.id === editing.id ? record as BossRecord : r) })); resetEdit(); };
  const del = async (id: string) => { if (!requireAdmin()) return; if (!window.confirm("이 기록을 삭제할까요?")) return; const { error } = await supabase.from("boss_records").delete().eq("id", id); if (error) return window.alert(`삭제 실패: ${error.message}`); setData(d => ({ ...d, records: d.records.filter(r => r.id !== id) })); };
  const resetAll = async () => { if (!requireAdmin()) return; if (!window.confirm("모든 보스 참여 기록을 정말 초기화할까요?")) return; const { error } = await supabase.from("boss_records").delete().not("id", "is", null); if (error) return window.alert(error.message); setData(d => ({ ...d, records: [] })); };
  const toggle = (name: string) => setSelected(s => s.includes(name) ? s.filter(x => x !== name) : [...s, name]);
  return <div className="stack"><PageIntro title="⚔️ 보스 참여 기록" desc="보스별 참여자를 저장하고 수정할 수 있습니다." />
    <div className="panel"><div className="panel-title"><span>➕ 참여 기록 추가</span><button className="danger-outline small" onClick={resetAll}><Lock size={13} /> 전체 초기화</button></div><div className="form-grid boss-form"><input type="date" value={date} onChange={e => setDate(e.target.value)} /><input placeholder="보스 이름" value={boss} onChange={e => setBoss(e.target.value)} /><input type="datetime-local" value={spawnTime} onChange={e => setSpawnTime(e.target.value)} /><input type="number" placeholder="보스 점수" value={score} onChange={e => setScore(e.target.value)} /></div><div className="member-picker">{data.members.map(m => <button key={m.id} className={selected.includes(m.name) ? "selected" : ""} onClick={() => toggle(m.name)}>{m.name}</button>)}</div><button className="primary" disabled={saving} onClick={add}><Plus size={16} /> {saving ? "저장 중..." : `참여 기록 저장 (${selected.length}명)`}</button></div>
    <div className="panel table-panel"><div className="table-wrap"><table className="boss-table"><thead><tr><th>날짜</th><th>보스</th><th>젠 시간</th><th>점수</th><th>참여자</th><th>관리</th></tr></thead><tbody>{data.records.map(r => <tr key={r.id}><td>{r.date}</td><td className="strong">{r.boss}</td><td>{formatSpawnTime(r.spawn_time)}</td><td>{formatNumber(r.score)}</td><td>{r.participants?.length ? r.participants.join(", ") : "-"}</td><td><div className="actions"><button title="수정" onClick={() => startEdit(r)}><Pencil size={14} /></button><button title="삭제" className="danger" onClick={() => del(r.id)}><Trash2 size={14} /></button></div></td></tr>)}</tbody></table></div>{!data.records.length && <Empty text="등록된 기록이 없습니다." />}</div>
    {editing && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) resetEdit(); }}><div className="member-edit-modal boss-edit-modal"><div className="modal-head"><div><div className="eyebrow">ECLIPSE BOSS RECORD</div><h3>✏️ 보스 참여 기록 수정</h3></div><button className="icon-btn" onClick={resetEdit}><X size={20} /></button></div><div className="edit-grid"><label>날짜<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label><label>보스 이름<input value={boss} onChange={e => setBoss(e.target.value)} /></label><label>젠 시간<input type="datetime-local" value={spawnTime} onChange={e => setSpawnTime(e.target.value)} /></label><label>보스 점수<input type="number" value={score} onChange={e => setScore(e.target.value)} /></label></div><div className="boss-edit-participants"><span>참여자</span><div className="member-picker">{data.members.map(m => <button key={m.id} className={selected.includes(m.name) ? "selected" : ""} onClick={() => toggle(m.name)}>{m.name}</button>)}</div></div><div className="modal-actions"><button className="secondary" onClick={resetEdit}>취소</button><button className="primary" disabled={saving} onClick={saveEdit}>{saving ? "저장 중..." : "수정 저장"}</button></div></div></div>}
  </div>;
}

function Distribution({ data, setData }: { data: AppData; setData: React.Dispatch<React.SetStateAction<AppData>> }) {
  const [totalPool, setTotalPool] = useState("0");
  const [ratio, setRatio] = useState("100");
  const [saving, setSaving] = useState(false);
  const [sort, setSort] = useState<"high" | "low">("high");
  const [bonusByName, setBonusByName] = useState<Record<string, number>>({});
  const settlementMemo = "ECLIPSE_AUTO_SETTLEMENT";

  const totalBossRecords = uniqueBossRecords(data.records).length;
  const targetAmount = Math.floor((Number(totalPool) || 0) * Math.min(100, Math.max(0, Number(ratio) || 0)) / 100);

  const members = useMemo(() => data.members.map(member => {
    const participationCount = data.records.filter(record => (record.participants || []).includes(member.name)).length;
    const participation = totalBossRecords ? (participationCount / totalBossRecords) * 100 : 0;
    return { member, participationCount, participation };
  }).sort((a, b) => sort === "high" ? b.participation - a.participation || totalPower(b.member) - totalPower(a.member) : a.participation - b.participation || totalPower(a.member) - totalPower(b.member)), [data.members, data.records, sort, totalBossRecords]);

  const participationSum = members.reduce((sum, row) => sum + row.participation, 0);
  const rows = members.map(row => ({
    ...row,
    amount: participationSum > 0 ? Math.floor(targetAmount * row.participation / participationSum) : 0,
  }));

  const paidRecords = data.distributions.filter(r => r.memo === settlementMemo);
  const paidByName = useMemo(() => {
    const map = new Map<string, DistributionRecord>();
    paidRecords.forEach(record => map.set(record.recipient, record));
    return map;
  }, [paidRecords]);
  const paidTotal = rows.reduce((sum, row) => sum + (paidByName.get(row.member.name)?.amount || 0), 0);
  const remaining = Math.max(0, targetAmount - paidTotal);
  const paidCount = rows.filter(row => paidByName.has(row.member.name)).length;

  const bonusFor = (row: typeof rows[number]) => {
    const existing = paidByName.get(row.member.name);
    if (existing) return Math.max(0, existing.amount - row.amount);
    return Math.max(0, bonusByName[row.member.name] || 0);
  };

  const saveBonus = async (row: typeof rows[number], value: number) => {
    const bonus = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
    setBonusByName(prev => ({ ...prev, [row.member.name]: bonus }));
    const existing = paidByName.get(row.member.name);
    if (!existing) return;
    const newAmount = row.amount + bonus;
    if (newAmount <= 0) return;
    const { data: updated, error } = await supabase.from("distribution_records").update({ amount: newAmount }).eq("id", existing.id).select().single();
    if (error) return window.alert(`추가 금액 수정 실패: ${error.message}`);
    setData(d => ({ ...d, distributions: d.distributions.map(r => r.id === existing.id ? updated as DistributionRecord : r) }));
  };

  const payMember = async (row: typeof rows[number]) => {
    if (row.amount <= 0) return window.alert("분배할 금액이 없습니다. 먼저 보스 참여 기록을 확인해주세요.");
    setSaving(true);
    const existing = paidByName.get(row.member.name);
    let result;
    if (existing) {
      result = await supabase.from("distribution_records").delete().eq("id", existing.id);
    } else {
      result = await supabase.from("distribution_records").insert({
        date: new Date().toISOString().slice(0, 10),
        recipient: row.member.name,
        amount: row.amount + bonusFor(row),
        reason: "분배금 정산",
        memo: settlementMemo,
      }).select().single();
    }
    setSaving(false);
    if (result.error) return window.alert(`처리 실패: ${result.error.message}`);
    if (existing) {
      setData(d => ({ ...d, distributions: d.distributions.filter(r => r.id !== existing.id) }));
    } else {
      setData(d => ({ ...d, distributions: [result.data as DistributionRecord, ...d.distributions] }));
    }
  };

  const resetSettlement = async () => {
    if (!paidRecords.length) return;
    if (!requireAdmin()) return;
    if (!window.confirm("현재 분배금 정산 상태를 모두 초기화할까요?")) return;
    setSaving(true);
    const { error } = await supabase.from("distribution_records").delete().eq("memo", settlementMemo);
    setSaving(false);
    if (error) return window.alert(`초기화 실패: ${error.message}`);
    setData(d => ({ ...d, distributions: d.distributions.filter(r => r.memo !== settlementMemo) }));
  };

  return <div className="stack distribution-settlement-page">
    <PageIntro title="💖 분배금 정산 내역" desc="보스 참여율을 기준으로 분배금을 자동 계산하고 지급 상태를 관리합니다." />

    <div className="distribution-controls">
      <div className="distribution-control-card highlight">
        <span>총 분배금</span>
        <input type="number" value={totalPool} onChange={e => setTotalPool(e.target.value)} />
      </div>
      <div className="distribution-control-card">
        <span>분배 대상 금액</span>
        <strong>{formatNumber(targetAmount)} 💎</strong>
      </div>
      <div className="distribution-control-card">
        <span>분배 비율 (%)</span>
        <input type="number" min="0" max="100" value={ratio} onChange={e => setRatio(e.target.value)} />
      </div>
      <div className="distribution-control-card">
        <span>총 지급액</span>
        <strong className="pink-number">{formatNumber(paidTotal)} 💎</strong>
      </div>
      <div className="distribution-control-card">
        <span>남은 금액</span>
        <strong className="pink-number">{formatNumber(remaining)} 💎</strong>
      </div>
    </div>

    <div className="distribution-settlement-panel">
      <div className="settlement-head">
        <div>
          <h3>길드원 분배 정산</h3>
          <p>보스 참여율 {totalBossRecords ? `${totalBossRecords}건 기준` : "기록 없음"} · {paidCount}/{rows.length}명 지급 완료</p>
        </div>
        <div className="settlement-tools">
          <select value={sort} onChange={e => setSort(e.target.value as "high" | "low")}>
            <option value="high">참여율 높은 순</option>
            <option value="low">참여율 낮은 순</option>
          </select>
          <button className="settlement-reset" disabled={saving || !paidRecords.length} onClick={resetSettlement}>↻ 정산 초기화</button>
        </div>
      </div>

      <div className="settlement-list">
        {rows.map(row => {
          const paid = paidByName.get(row.member.name);
          return <div className={`settlement-row ${paid ? "is-paid" : ""}`} key={row.member.id}>
            <div className="settlement-name">
              <strong>{row.member.name}</strong>
              <span>참여율 {row.participation.toFixed(0)}%</span>
            </div>
            <div className="settlement-base">
              <span>기본 참여율 분배금</span>
              <strong>{formatNumber(row.amount)} 💎</strong>
            </div>
            <div className="settlement-bonus">
              <span>추가 분배금</span>
              <input
                type="number"
                min="0"
                step="1"
                value={bonusFor(row)}
                onChange={e => setBonusByName(prev => ({ ...prev, [row.member.name]: Math.max(0, Number(e.target.value) || 0) }))}
                onBlur={e => saveBonus(row, Number(e.target.value) || 0)}
                aria-label={`${row.member.name} 추가 분배금`}
              />
              <b>💎</b>
            </div>
            <div className="settlement-amount"><span>총 지급액</span><strong>{formatNumber(row.amount + bonusFor(row))} 💎</strong></div>
            <button className={`payment-button ${paid ? "paid" : ""}`} disabled={saving} onClick={() => payMember(row)}>
              <span className="payment-square">{paid ? "✓" : "■"}</span>{paid ? "지급완료" : "미지급"}
            </button>
          </div>;
        })}
        {!rows.length && <Empty text="등록된 길드원이 없습니다." />}
      </div>
    </div>

    <div className="distribution-note">
      <span>💡</span>
      <p><b>자동 계산 방식</b> · 각 길드원의 참여율을 합산한 뒤, 분배 대상 금액을 참여율 비중대로 자동 배분합니다. 금액은 1 다이아 단위로 내림 처리됩니다.</p>
    </div>
  </div>;
}

function Stats({ data }: { data: AppData }) {
  const bossRecords = uniqueBossRecords(data.records);
  const total = bossRecords.length;
  const rows = data.members.map(m => ({ name: m.name, count: bossRecords.filter(r => r.participants.includes(m.name)).length, attendance: data.attendance.filter(a => a.member_name === m.name && a.status === "present").length })).sort((a, b) => b.count - a.count);
  const today = new Date().toISOString().slice(0, 10);
  const todayAttendance = data.attendance.filter(a => a.attendance_date === today && a.status === "present");
  return <div className="stack"><PageIntro title="📅 참여율 기록" desc="보스 참여율과 Discord 출석 현황을 확인합니다." /><div className="cards cards-3"><StatCard icon={<CalendarDays />} label="전체 보스 기록" value={`${total}건`} /><StatCard icon={<Users />} label="전체 보스 참여" value={`${bossRecords.reduce((a, r) => a + r.participants.length, 0)}회`} /><StatCard icon={<CalendarDays />} label="오늘 Discord 출석" value={`${todayAttendance.length}명`} accent="pink" /></div><div className="panel"><div className="panel-title"><span>길드원별 참여 현황</span></div><div className="table-wrap"><table className="stats-table"><thead><tr><th>길드원</th><th>보스 참여</th><th>참여율</th><th>Discord 출석</th></tr></thead><tbody>{rows.map(r => <tr key={r.name}><td className="strong">{r.name}</td><td>{r.count}회</td><td><div className="mini-rate"><span>{total ? Math.round(r.count / total * 100) : 0}%</span><i style={{ width: `${total ? Math.min(100, r.count / total * 100) : 0}%` }} /></div></td><td>{r.attendance}회</td></tr>)}</tbody></table></div>{!rows.length && <Empty text="길드원을 등록하면 참여율이 표시됩니다." />}</div><div className="panel"><div className="panel-title"><span>🤖 최근 Discord 출석</span><span className="muted">최근 30건</span></div>{data.attendance.length ? <div className="table-wrap"><table className="stats-table"><thead><tr><th>날짜</th><th>길드원</th><th>Discord</th><th>상태</th></tr></thead><tbody>{data.attendance.slice(0,30).map(a => <tr key={a.id}><td>{a.attendance_date}</td><td className="strong">{a.member_name}</td><td>{a.discord_display_name || "-"}</td><td><span className="status-chip paid">출석</span></td></tr>)}</tbody></table></div> : <Empty text="Discord에서 출석한 기록이 없습니다." />}</div></div>;
}

function MemoManager({ data, setData }: { data: AppData; setData: React.Dispatch<React.SetStateAction<AppData>> }) {
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<AdminMemo | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [viewing, setViewing] = useState<AdminMemo | null>(null);
  const [memoPage, setMemoPage] = useState(1);
  const MEMOS_PER_PAGE = 6;

  const rows = useMemo(() => data.memos.filter(m => `${m.title} ${m.content}`.toLowerCase().includes(q.trim().toLowerCase())), [data.memos, q]);
  const totalMemoPages = Math.max(1, Math.ceil(rows.length / MEMOS_PER_PAGE));
  const pagedRows = rows.slice((memoPage - 1) * MEMOS_PER_PAGE, memoPage * MEMOS_PER_PAGE);
  useEffect(() => { setMemoPage(1); }, [q]);
  useEffect(() => { if (memoPage > totalMemoPages) setMemoPage(totalMemoPages); }, [memoPage, totalMemoPages]);

  const openNew = () => {
    setEditing(null);
    setTitle("");
    setContent("");
    setEditorOpen(true);
  };
  const openView = (memo: AdminMemo) => {
    setViewing(memo);
  };
  const closeView = () => setViewing(null);

  const openEdit = (memo: AdminMemo) => {
    setEditing(memo);
    setTitle(memo.title);
    setContent(memo.content);
    setEditorOpen(true);
  };
  const closeEditor = () => {
    setEditing(null);
    setTitle("");
    setContent("");
    setEditorOpen(false);
  };

  const save = async () => {
    if (!title.trim()) return window.alert("제목을 입력해주세요.");
    if (!content.trim()) return window.alert("내용을 입력해주세요.");
    if (!requireAdmin()) return;
    setSaving(true);
    const payload = { title: title.trim(), content: content.trim(), updated_at: new Date().toISOString() };
    const result = editing
      ? await supabase.from("admin_memos").update(payload).eq("id", editing.id).select().single()
      : await supabase.from("admin_memos").insert({ ...payload, created_at: new Date().toISOString() }).select().single();
    setSaving(false);
    if (result.error) return window.alert(`게시글 저장 실패: ${result.error.message}`);
    const saved = result.data as AdminMemo;
    setData(d => ({ ...d, memos: editing ? d.memos.map(m => m.id === editing.id ? saved : m) : [saved, ...d.memos] }));
    closeEditor();
  };

  const remove = async (memo: AdminMemo) => {
    if (!requireAdmin()) return;
    if (!window.confirm("이 게시글을 삭제할까요?")) return;
    const { error } = await supabase.from("admin_memos").delete().eq("id", memo.id);
    if (error) return window.alert(`삭제 실패: ${error.message}`);
    setData(d => ({ ...d, memos: d.memos.filter(m => m.id !== memo.id) }));
  };

  const dateText = (value: string) => new Date(value).toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

  return <div className="stack">
    <div className="memo-page-head">
      <PageIntro title="📝 관리자 메모" desc="길드 운영 공지와 메모를 게시판처럼 작성하고 관리합니다." badge="ADMIN" />
      <button className="primary memo-create-button" onClick={openNew}><Plus size={16} /> 작성</button>
    </div>
    <div className="panel">
      <div className="members-toolbar">
        <div className="search member-search"><Search size={17} /><input placeholder="제목 또는 내용 검색" value={q} onChange={e => setQ(e.target.value)} /></div>
        <div className="memo-board-actions"><span className="admin-chip"><Lock size={12} /> 관리자 전용</span></div>
      </div>
    </div>

    <div className="memo-board">
      {pagedRows.map((memo, index) => <article className="memo-post memo-post-clickable" key={memo.id} onClick={() => openView(memo)} role="button" tabIndex={0} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openView(memo); } }}>
        <div className="memo-post-no">{rows.length - ((memoPage - 1) * MEMOS_PER_PAGE + index)}</div>
        <div className="memo-post-main">
          <div className="memo-post-head"><div><h3>{memo.title}</h3><span className="memo-post-date">{dateText(memo.updated_at || memo.created_at)}</span></div></div>
          <p className="memo-post-content">{memo.content}</p>
          <span className="memo-post-read-hint">클릭해서 전체 내용 보기</span>
        </div>
        <div className="memo-post-actions" onClick={e => e.stopPropagation()}><button className="secondary small" onClick={() => openEdit(memo)}><Pencil size={13} /> 수정</button><button className="danger-outline small" onClick={() => remove(memo)}><Trash2 size={13} /> 삭제</button></div>
      </article>)}
      {!rows.length && <div className="panel"><Empty text={q ? "검색 결과가 없습니다." : "작성된 메모가 없습니다. 상단의 '글 작성' 버튼으로 첫 글을 작성해주세요."} /></div>}
    </div>

    {rows.length > 0 && <div className="memo-pagination" aria-label="관리자 메모 페이지 이동">
      <button className="secondary small" disabled={memoPage === 1} onClick={() => setMemoPage(p => Math.max(1, p - 1))}>‹ 이전</button>
      <div className="memo-page-numbers">{Array.from({ length: totalMemoPages }, (_, i) => i + 1).map(page => <button key={page} className={page === memoPage ? "active" : ""} onClick={() => setMemoPage(page)}>{page}</button>)}</div>
      <button className="secondary small" disabled={memoPage === totalMemoPages} onClick={() => setMemoPage(p => Math.min(totalMemoPages, p + 1))}>다음 ›</button>
    </div>}

    {viewing && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) closeView(); }}>
      <div className="member-edit-modal memo-view-modal">
        <div className="modal-head"><div><div className="eyebrow">ADMIN MEMO BOARD</div><h3>📖 {viewing.title}</h3><span className="memo-view-date">{dateText(viewing.updated_at || viewing.created_at)}</span></div><button className="icon-btn" onClick={closeView}><X size={20} /></button></div>
        <div className="memo-view-content">{viewing.content}</div>
        <div className="modal-actions"><button className="secondary" onClick={closeView}>닫기</button><button className="primary" onClick={() => { closeView(); openEdit(viewing); }}><Pencil size={14} /> 수정</button></div>
      </div>
    </div>}

    {editorOpen && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) closeEditor(); }}>
      <div className="member-edit-modal memo-board-modal">
        <div className="modal-head"><div><div className="eyebrow">ADMIN MEMO BOARD</div><h3>{editing ? "✏️ 관리자 메모 수정" : "📝 관리자 메모 작성"}</h3></div><button className="icon-btn" onClick={closeEditor}><X size={20} /></button></div>
        <label className="memo-field-label">제목<input value={title} onChange={e => setTitle(e.target.value)} placeholder="게시글 제목을 입력하세요." /></label>
        <label className="memo-field-label">내용<textarea className="memo-editor board-editor" value={content} onChange={e => setContent(e.target.value)} placeholder="길드 운영에 필요한 내용을 작성하세요." /></label>
        <div className="modal-actions"><button className="secondary" onClick={closeEditor}>취소</button><button className="primary" disabled={saving} onClick={save}>{saving ? "저장 중..." : "메모 저장"}</button></div>
      </div>
    </div>}
  </div>;
}

function Ladder({ members }: { members: Member[] }) {
  const [players, setPlayers] = useState<string[]>([]); const [results, setResults] = useState<string[]>(["당첨", "꽝"]); const [out, setOut] = useState<Record<string, string> | null>(null); const [running, setRunning] = useState(false);
  const shuffle = () => {
    if (players.length < 2) return window.alert("참가자는 2명 이상 선택해주세요.");
    if (players.length > 10) return window.alert("참가자는 최대 10명까지 가능합니다.");
    if (results.length !== players.length) return window.alert("결과 항목 수를 참가자 수와 맞춰주세요.");
    setRunning(true); setOut(null);
    window.setTimeout(() => {
      const a = [...results].sort(() => Math.random() - 0.5); const p = [...players].sort(() => Math.random() - 0.5); const map: Record<string, string> = {}; p.forEach((name, i) => { map[name] = a[i]; }); setOut(map); setRunning(false);
    }, 900);
  };
  const addResult = () => { if (results.length >= 10) return; setResults([...results, `결과 ${results.length + 1}`]); };
  return <div className="stack"><PageIntro title="🎲 사다리 게임" desc="2~10명의 길드원을 선택하고 결과를 랜덤 배정합니다. 누구나 사용할 수 있습니다." />
    <div className="ladder-top"><div className="ladder-count"><strong>{players.length}</strong><span>/ 10명 선택</span></div><button className="secondary" onClick={() => { setPlayers([]); setOut(null); }}>전체 초기화</button></div>
    <div className="grid-2 ladder-layout"><div className="panel"><div className="panel-title"><span>👥 참가자 선택</span><span className="muted">최대 10명</span></div><div className="member-picker ladder-picker">{members.map(m => <button key={m.id} className={players.includes(m.name) ? "selected" : ""} onClick={() => { setOut(null); setPlayers(s => s.includes(m.name) ? s.filter(x => x !== m.name) : s.length >= 10 ? s : [...s, m.name]); }}>{players.includes(m.name) ? "✓ " : ""}{m.name}</button>)}</div></div>
      <div className="panel"><div className="panel-title"><span>🎯 결과 항목</span><button className="small" onClick={addResult}><Plus size={14} /> 추가</button></div><div className="result-list">{results.map((r, i) => <div className="result-input" key={i}><span>{i + 1}</span><input value={r} onChange={e => setResults(results.map((x, j) => j === i ? e.target.value : x))} />{results.length > 2 && <button onClick={() => setResults(results.filter((_, j) => j !== i))}><X size={14} /></button>}</div>)}</div><button className="primary full ladder-run" disabled={running} onClick={shuffle}>{running ? "🎲 사다리 추첨 중..." : "🎲 사다리 돌리기"}</button></div></div>
    {out && <div className="panel ladder-result"><div className="panel-title"><span>🎉 사다리 결과</span><span className="muted">랜덤 배정 완료</span></div><div className="result-grid">{Object.entries(out).map(([p, r]) => <div className="result-card" key={p}><div className="result-avatar">🐰</div><strong>{p}</strong><span>{r}</span></div>)}</div></div>}
  </div>;
}

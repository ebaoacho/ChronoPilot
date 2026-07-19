"use client";

import { useEffect, useMemo, useState } from "react";
import { Bot, CalendarPlus, LocateFixed, MapPin, MessageCircle, Send, X } from "lucide-react";
import type { PlanBlock, TaskInput } from "@/lib/domain/types";
import type { LifeCoachResult } from "@/lib/domain/life-coach";
import type { z } from "zod";
import type { routeEstimateSchema } from "@/lib/domain/schemas";
import { selectCoachBlocks } from "@/lib/domain/coach-context";

type Message = { role: "user" | "assistant"; content: string };
type RouteEstimate = z.infer<typeof routeEstimateSchema>;
type CoachResponse = LifeCoachResult & {
  aiMode: "openai" | "fallback";
  aiIssue?: "authentication" | "permission" | "model" | "quota_or_rate_limit" | "provider_unavailable" | "invalid_response";
  calendarConnected: boolean;
  writeMode: "confirm" | "today" | "all" | "readonly";
  calendarContextCount: number;
};

const aiIssueText: Record<NonNullable<CoachResponse["aiIssue"]>, string> = {
  authentication: "AI APIキーを確認してください",
  permission: "AI APIの利用権限を確認してください",
  model: "OPENAI_MODELのモデル名を確認してください",
  quota_or_rate_limit: "AI APIの残高または利用上限を確認してください",
  provider_unavailable: "AIサービスが一時的に応答していません",
  invalid_response: "AI応答を検証できなかったため再試行してください"
};

const examples = [
  "今から30分ゲームしていい？",
  "急に外出することになった。予定に間に合う？",
  "タバコを吸いたい。今吸うと予定に影響する？"
];

export function LifeCoachChat({ blocks, tasks, freeMinutes, onCalendarAdded }: { blocks: PlanBlock[]; tasks: TaskInput[]; freeMinutes: number; onCalendarAdded?: (block: PlanBlock) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [result, setResult] = useState<CoachResponse>();
  const [loading, setLoading] = useState(false);
  const [destination, setDestination] = useState("");
  const [mode, setMode] = useState<"DRIVE" | "WALK" | "BICYCLE" | "TRANSIT">("TRANSIT");
  const [manualMinutes, setManualMinutes] = useState("");
  const [position, setPosition] = useState<{ latitude: number; longitude: number }>();
  const [routeNote, setRouteNote] = useState("");
  const [registering, setRegistering] = useState(false);
  const [calendarMessage, setCalendarMessage] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const saved = sessionStorage.getItem("chronopilot-coach-chat");
        if (saved) setMessages(JSON.parse(saved) as Message[]);
      } catch { /* private browsing can disable storage */ }
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    try { sessionStorage.setItem("chronopilot-coach-chat", JSON.stringify(messages.slice(-20))); } catch { /* no persistence */ }
  }, [messages]);

  const verdict = useMemo(() => result ? ({ yes: "できます", yes_with_limit: "条件つきでできます", not_now: "今は調整がおすすめ", need_more_info: "追加情報が必要" })[result.verdict] : "", [result]);

  function locate() {
    if (!navigator.geolocation) return setRouteNote("この端末では現在地を取得できません。");
    setRouteNote("現在地を確認しています…");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => { setPosition({ latitude: coords.latitude, longitude: coords.longitude }); setRouteNote("現在地を使えます。位置情報は保存しません。"); },
      () => setRouteNote("現在地を取得できませんでした。許可設定を確認するか、所要時間を手入力してください。"),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  }

  async function getRoute(): Promise<RouteEstimate | undefined> {
    const manual = Number(manualMinutes);
    if (destination && Number.isFinite(manual) && manual > 0) return { durationMinutes: Math.ceil(manual), distanceMeters: 0, source: "manual", mode, destination };
    if (!destination || !position) return undefined;
    const response = await fetch("/api/routes/estimate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ origin: position, destination, mode }) });
    const body = await response.json() as RouteEstimate & { error?: string };
    if (!response.ok) { setRouteNote(body.error ?? "経路を取得できませんでした。"); return undefined; }
    setRouteNote(`約${body.durationMinutes}分・${(body.distanceMeters / 1000).toFixed(1)}km（Google Routes）`);
    return body;
  }

  async function send(value = text) {
    const content = value.trim();
    if (!content || loading) return;
    setLoading(true); setText(""); setResult(undefined); setCalendarMessage("");
    const userMessage: Message = { role: "user", content };
    const nextMessages = [...messages, userMessage].slice(-20);
    setMessages(nextMessages);
    try {
      const route = await getRoute();
      const now = new Date().toISOString();
      const relevantBlocks = selectCoachBlocks(blocks, now);
      const response = await fetch("/api/ai/chat", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.slice(-12), now, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Tokyo",
          blocks: relevantBlocks.map(({ title, kind, startsAt, endsAt, fixed }) => ({ title, kind, startsAt, endsAt, fixed })),
          tasks: tasks.slice(0,80).map(({ title, estimateMinutes, priority, required }) => ({ title, estimateMinutes, priority, required })),
          freeMinutes, route
        })
      });
      const body = await response.json() as CoachResponse & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "相談できませんでした");
      setResult(body);
      const assistantMessage: Message = { role: "assistant", content: body.reply };
      setMessages([...nextMessages, assistantMessage].slice(-20));
    } catch (error) {
      const message = error instanceof Error ? error.message : "通信できませんでした";
      const assistantMessage: Message = { role: "assistant", content: `${message}。通信回復後にもう一度試してください。` };
      setMessages([...nextMessages, assistantMessage].slice(-20));
    } finally { setLoading(false); }
  }

  async function registerCalendarProposal() {
    const proposal = result?.calendarProposal;
    if (!proposal || registering || !result.calendarConnected || result.writeMode === "readonly") return;
    setRegistering(true); setCalendarMessage("");
    const proposalId = crypto.randomUUID();
    const id = crypto.randomUUID();
    try {
      const response = await fetch("/api/calendar/write-plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ proposalId, blocks: [{ id, proposalId, ...proposal, source: "ai_suggestion" }] })
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Google Calendarへ登録できませんでした");
      onCalendarAdded?.({ id, title: proposal.title, kind: proposal.kind, startsAt: proposal.startsAt, endsAt: proposal.endsAt, status: "planned", fixed: true });
      setCalendarMessage("Google Calendarへ登録しました。");
      setResult((current) => current ? { ...current, calendarProposal: undefined } : current);
    } catch (error) {
      setCalendarMessage(error instanceof Error ? error.message : "Google Calendarへ登録できませんでした");
    } finally { setRegistering(false); }
  }

  function proposalTime(startsAt: string, endsAt: string) {
    const formatter = new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" });
    const endFormatter = new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" });
    return `${formatter.format(new Date(startsAt))}〜${endFormatter.format(new Date(endsAt))}`;
  }

  if (!open) return <button className="coach-launch" onClick={() => setOpen(true)}><MessageCircle size={20}/> もう一人の私に相談</button>;
  return <section className="card coach" aria-label="AIライフコーチ">
    <div className="coach-header"><div><div className="eyebrow">Life Coach</div><h2><Bot size={20}/> もう一人の私</h2></div><button className="icon-button" aria-label="閉じる" onClick={() => setOpen(false)}><X size={20}/></button></div>
    <p className="muted coach-intro">今していいこと、予定への影響、急な外出を相談できます。時間計算は予定データから行い、AIに推測させません。</p>
    <div className="coach-examples">{examples.map((example) => <button key={example} onClick={() => void send(example)}>{example}</button>)}</div>
    {messages.length > 0 && <div className="coach-messages" aria-live="polite">{messages.slice(-6).map((message, index) => <div key={`${message.role}-${index}`} className={`coach-message ${message.role}`}>{message.content}</div>)}</div>}
    {result && <div className="coach-result"><span className="pill">{verdict}</span>{result.impacts.map((impact) => <div className="coach-impact" key={`${impact.label}-${impact.after}`}><strong>{impact.label}</strong><span>{impact.before}{impact.after ? ` → ${impact.after}` : ""}</span></div>)}{result.options.map((option) => <div className="coach-option" key={option.label}><strong>{option.recommended ? "おすすめ：" : "候補："}{option.label}</strong><span>{option.description}</span></div>)}{result.calendarProposal&&<div className="coach-calendar-proposal"><strong><CalendarPlus size={17}/> カレンダー登録候補</strong><span>{result.calendarProposal.title}</span><span className="muted">{proposalTime(result.calendarProposal.startsAt,result.calendarProposal.endsAt)}</span><span className="muted">{result.calendarProposal.reason}</span><button className="button" disabled={registering||!result.calendarConnected||result.writeMode==="readonly"} onClick={()=>void registerCalendarProposal()}><CalendarPlus size={17}/>{registering?"登録中…":result.writeMode==="readonly"?"読み取り専用":result.calendarConnected?"Google Calendarへ追加":"Google Calendar未接続"}</button></div>}{calendarMessage&&<p className="planner-note">{calendarMessage}</p>}<small className="muted">{result.calendarContextCount>0&&`連携予定${result.calendarContextCount}件を参照 · `}{result.aiMode === "openai" ? "AIが表現と選択肢を生成・時間判定は計算ロジック" : result.aiIssue ? `ルールベース応答：${aiIssueText[result.aiIssue]}` : "安全なルールベース応答"}</small></div>}
    <details className="route-controls"><summary><MapPin size={16}/> 移動時間も調べる</summary><div className="field"><label>行き先</label><input value={destination} onChange={(event) => setDestination(event.target.value)} placeholder="例：東京駅、大学名、住所"/></div><div className="route-grid"><div className="field"><label>移動手段</label><select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}><option value="TRANSIT">公共交通</option><option value="DRIVE">車</option><option value="WALK">徒歩</option><option value="BICYCLE">自転車</option></select></div><div className="field"><label>所要時間（手入力・任意）</label><input type="number" min="1" max="1440" value={manualMinutes} onChange={(event) => setManualMinutes(event.target.value)} placeholder="分"/></div></div><button className="button secondary" onClick={locate}><LocateFixed size={17}/> 現在地を使う</button>{routeNote && <p className="muted">{routeNote}</p>}</details>
    <div className="coach-compose"><textarea aria-label="相談内容" value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="例：今からゲームしていい？"/><button className="button" disabled={loading || !text.trim()} onClick={() => void send()}><Send size={18}/>{loading ? "考え中" : "相談"}</button></div>
  </section>;
}

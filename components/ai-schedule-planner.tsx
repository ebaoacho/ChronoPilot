"use client";

import { useState } from "react";
import { CalendarCheck, Check, Sparkles } from "lucide-react";
import { format } from "date-fns";
import { ja } from "date-fns/locale";

export type SuggestedBlock = { id: string; proposalId: string; title: string; startsAt: string; endsAt: string; reason: string; kind?: "event"|"task"|"travel"|"routine"|"sleep"; location?:string; source: "ai_suggestion" };
type RecurringSeries={id:string;title:string;kind:"event"|"task"|"travel"|"routine"|"sleep";startsAt:string;endsAt:string;reason:string;location?:string;recurrence:string;timeZone:string;weekdays:number[]};
type Proposal = {
  proposalId: string; goalTitle: string; summary: string; deadlineAt: string; blocks: SuggestedBlock[];
  unscheduled: Array<{ title: string; minutes: number }>; warnings: string[]; assumptions: string[];
  proposalType:"goal"|"recurring";proposalKind?:"morning_routine";series?:RecurringSeries[];recurrenceLabel?:string;
  aiMode: "openai" | "fallback"|"hybrid"; calendarConnected: boolean; writeMode: "confirm" | "today" | "all" | "readonly";
};

export function AiSchedulePlanner({ connected, onRegistered }: { connected: boolean; onRegistered: (blocks: SuggestedBlock[]) => Promise<void> }) {
  const [text, setText] = useState("");
  const [deadline, setDeadline] = useState("");
  const [horizon, setHorizon] = useState(14);
  const [autoRegister, setAutoRegister] = useState(false);
  const [proposal, setProposal] = useState<Proposal>();
  const [loading, setLoading] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [message, setMessage] = useState("");

  async function registerPlan(value: Proposal) {
    if (!value.calendarConnected || value.writeMode === "readonly") return;
    setRegistering(true); setMessage("");
    try {
      const recurring=value.proposalType==="recurring";
      const response = await fetch(recurring?"/api/calendar/write-recurring":"/api/calendar/write-plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(recurring?{ proposalId: value.proposalId, series:value.series,blocks:value.blocks }:{ proposalId: value.proposalId, blocks: value.blocks }) });
      const body = await response.json() as { registered?: Array<{ title: string }>; error?: string; conflicts?: unknown[] };
      if (!response.ok) throw new Error(body.error ?? "登録できませんでした");
      setMessage(recurring?`${body.registered?.length ?? 0}種類の定期予定をGoogle Calendarへ登録しました。`:`${body.registered?.length ?? 0}件をGoogle Calendarへ登録しました。`);
      await onRegistered(value.blocks);
    } catch (error) { setMessage(error instanceof Error ? error.message : "登録できませんでした"); }
    finally { setRegistering(false); }
  }

  async function propose() {
    if (!text.trim() || loading) return;
    setLoading(true); setMessage(""); setProposal(undefined);
    try {
      const response = await fetch("/api/ai/schedule-goal", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text, deadlineAt: deadline ? new Date(deadline).toISOString() : undefined, horizonDays: horizon,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Tokyo",
          timezoneOffsetMinutes: new Date().getTimezoneOffset(), workdayStartHour: 9, workdayEndHour: 22
        })
      });
      const body = await response.json() as Proposal & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "提案を作成できませんでした");
      setProposal(body);
      if (autoRegister && body.calendarConnected && body.writeMode !== "readonly" && body.blocks.length) await registerPlan(body);
    } catch (error) { setMessage(error instanceof Error ? error.message : "提案を作成できませんでした"); }
    finally { setLoading(false); }
  }

  return <section className="card ai-planner">
    <div className="eyebrow">AI Schedule</div>
    <h2><Sparkles size={20}/> 目標から予定を自動提案</h2>
    <p className="muted">面接対策、試験勉強、提出準備などを作業へ分解します。時刻指定が重なっている場合も、予定を失わず同じ時間帯へすべて登録します。</p>
    <div className="field"><label>やりたいこと・確定した予定</label><textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="例：7月30日に面接が決まった。企業研究、想定質問の整理、模擬面接を準備したい"/></div>
    <div className="planner-fields"><div className="field"><label>締切・本番日時（任意）</label><input type="datetime-local" value={deadline} onChange={(event) => setDeadline(event.target.value)}/></div><div className="field"><label>提案する期間</label><select value={horizon} onChange={(event) => setHorizon(Number(event.target.value))}><option value="7">7日</option><option value="14">14日</option><option value="30">30日</option><option value="60">60日</option></select></div></div>
    <label className="planner-check"><input type="checkbox" checked={autoRegister} disabled={!connected} onChange={(event) => setAutoRegister(event.target.checked)}/> 提案後、そのままGoogle Calendarへ登録する</label>
    {!connected && <p className="muted">Google Calendar未接続でも提案は作れます。登録するには先にCalendarを接続してください。</p>}
    <button className="button" disabled={loading || !text.trim()} onClick={() => void propose()}><Sparkles size={17}/>{loading ? "空き時間を確認中…" : "AIに予定を提案してもらう"}</button>
    {message && <p role="status" className="planner-message">{message}</p>}
    {proposal && <div className="planner-result">
      <div><span className="pill">{proposal.proposalKind==="morning_routine"?(proposal.aiMode==="openai"?"AIルーティン提案 + 睡眠優先の時刻計算":"標準ルーティン + 睡眠優先の時刻計算"):proposal.aiMode === "openai" ? "AI分解 + 時間計算" : proposal.aiMode==="hybrid"?"定期予定を認識 + 安全な時刻計算":"ルールベース分解 + 時間計算"}</span><h3>{proposal.goalTitle}</h3><p className="muted">{proposal.summary}</p>{proposal.recurrenceLabel&&<span className="pill">{proposal.recurrenceLabel}</span>}</div>
      {proposal.blocks.length ? <><div className="planner-blocks">{proposal.blocks.slice(0,12).map((block) => <article key={block.id} className="planner-block"><div className="planner-date">{format(new Date(block.startsAt), "M/d (E)", { locale: ja })}</div><div><strong>{block.title}</strong><div>{format(new Date(block.startsAt), "H:mm")}–{format(new Date(block.endsAt), "H:mm")}</div><small className="muted">{block.reason}</small></div></article>)}</div>{proposal.blocks.length>12&&<p className="muted">ほか {proposal.blocks.length-12}件 · Google Calendarには期間内のすべてを定期予定として登録します。</p>}</> : <p>配置できる時間が見つかりませんでした。</p>}
      {[...proposal.warnings, ...proposal.assumptions].map((warning) => <p className="muted planner-note" key={warning}>※ {warning}</p>)}
      {proposal.unscheduled.map((item) => <p className="planner-note" key={`${item.title}-${item.minutes}`}>未配置：{item.title}（{item.minutes}分）</p>)}
      {proposal.calendarConnected && proposal.writeMode !== "readonly" && proposal.blocks.length > 0 && !autoRegister && <button className="button" disabled={registering} onClick={() => void registerPlan(proposal)}><CalendarCheck size={18}/>{registering ? "登録中…" : "この提案をGoogle Calendarに登録"}</button>}
      {proposal.writeMode === "readonly" && <p className="planner-note">Calendarが読み取り専用のため、提案だけ表示しています。</p>}
      {message.includes("登録しました") && <p className="planner-success"><Check size={17}/> 登録済み</p>}
    </div>}
  </section>;
}

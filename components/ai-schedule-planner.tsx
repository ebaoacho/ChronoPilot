"use client";

import { useState } from "react";
import { CalendarCheck, Check, Pencil, Sparkles, Trash2, X } from "lucide-react";
import { format } from "date-fns";
import { ja } from "date-fns/locale";

export type SuggestedBlock = { id: string; proposalId: string; title: string; startsAt: string; endsAt: string; reason: string; kind?: "event"|"task"|"travel"|"routine"|"sleep"; location?:string; source: "ai_suggestion" };
type RecurringSeries={id:string;title:string;kind:"event"|"task"|"travel"|"routine"|"sleep";startsAt:string;endsAt:string;reason:string;location?:string;recurrence:string;timeZone:string;weekdays:number[]};
type ExistingEventRef = { id: string; title: string; startsAt: string; endsAt: string };
type RoughPlanUpdate = { title: string; reason: string; newStartsAt?: string; newEndsAt?: string; event?: ExistingEventRef; confidence: "matched"|"ambiguous"|"not_found" };
type RoughPlanDelete = { title: string; reason: string; event?: ExistingEventRef; confidence: "matched"|"ambiguous"|"not_found" };
type Proposal = {
  proposalId: string; goalTitle: string; summary: string; deadlineAt: string; blocks: SuggestedBlock[];
  standaloneBlocks?: SuggestedBlock[]; updates?: RoughPlanUpdate[]; deletes?: RoughPlanDelete[];
  unscheduled: Array<{ title: string; minutes: number }>; warnings: string[]; assumptions: string[];
  proposalType:"goal"|"recurring"|"rough_plan";proposalKind?:"morning_routine"|"sleep_schedule"|"flexible_event";series?:RecurringSeries[];recurrenceLabel?:string;
  aiMode: "openai" | "fallback"|"hybrid"; calendarConnected: boolean; writeMode: "confirm" | "today" | "all" | "readonly";
};

function UpdateCard({ item, connected, writeMode, onDone }: { item: RoughPlanUpdate; connected: boolean; writeMode: Proposal["writeMode"]; onDone: () => void }) {
  const [applying, setApplying] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const canApply = item.confidence === "matched" && Boolean(item.event) && Boolean(item.newStartsAt) && Boolean(item.newEndsAt) && connected && writeMode !== "readonly";
  async function apply() {
    if (!item.event || !canApply || applying) return;
    setApplying(true); setError("");
    try {
      const response = await fetch(`/api/calendar/events/${item.event.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ startsAt: item.newStartsAt, endsAt: item.newEndsAt }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "変更できませんでした");
      setDone(true); onDone();
    } catch (value) { setError(value instanceof Error ? value.message : "変更できませんでした"); }
    finally { setApplying(false); }
  }
  return <article className="planner-block">
    <div><Pencil size={18}/></div>
    <div><strong>{item.title}</strong>{item.event && item.newStartsAt && item.newEndsAt && <div>{format(new Date(item.event.startsAt), "M/d H:mm")} → {format(new Date(item.newStartsAt), "M/d H:mm")}–{format(new Date(item.newEndsAt), "H:mm")}</div>}<small className="muted">{item.reason}</small>
      {item.confidence !== "matched" && <p className="planner-note">{item.confidence === "ambiguous" ? "候補が複数見つかりました。カレンダー画面から手動で変更してください。" : "対象の予定が見つかりませんでした。カレンダー画面から手動で変更してください。"}</p>}
      {error && <p className="planner-note">{error}</p>}
      {canApply && !done && <button className="button secondary" disabled={applying} onClick={() => void apply()}>{applying ? "変更中…" : "この変更を適用"}</button>}
      {done && <p className="planner-success"><Check size={16}/> 変更しました</p>}
    </div>
  </article>;
}

function DeleteCard({ item, connected, writeMode, onDone }: { item: RoughPlanDelete; connected: boolean; writeMode: Proposal["writeMode"]; onDone: () => void }) {
  const [applying, setApplying] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const canApply = item.confidence === "matched" && Boolean(item.event) && connected && writeMode !== "readonly";
  async function apply() {
    if (!item.event || !canApply || applying) return;
    setApplying(true); setError("");
    try {
      const response = await fetch(`/api/calendar/events/${item.event.id}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ scope: "single" }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "削除できませんでした");
      setDone(true); onDone();
    } catch (value) { setError(value instanceof Error ? value.message : "削除できませんでした"); }
    finally { setApplying(false); }
  }
  return <article className="planner-block">
    <div><Trash2 size={18}/></div>
    <div><strong>{item.title}</strong>{item.event && <div>{format(new Date(item.event.startsAt), "M/d H:mm")}–{format(new Date(item.event.endsAt), "H:mm")}</div>}<small className="muted">{item.reason}</small>
      {item.confidence !== "matched" && <p className="planner-note">{item.confidence === "ambiguous" ? "候補が複数見つかりました。カレンダー画面から手動で削除してください。" : "対象の予定が見つかりませんでした。カレンダー画面から手動で削除してください。"}</p>}
      {error && <p className="planner-note">{error}</p>}
      {canApply && !done && <button className="button danger-button" disabled={applying} onClick={() => void apply()}>{applying ? "削除中…" : <><X size={16}/>この予定をキャンセル</>}</button>}
      {done && <p className="planner-success"><Check size={16}/> 削除しました</p>}
    </div>
  </article>;
}

export function AiSchedulePlanner({ connected, onRegistered, onCalendarChanged }: { connected: boolean; onRegistered: (blocks: SuggestedBlock[]) => Promise<void>; onCalendarChanged?: () => void }) {
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
      const allBlocks=[...value.blocks,...(value.standaloneBlocks??[])];
      const response = await fetch(recurring?"/api/calendar/write-recurring":"/api/calendar/write-plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(recurring?{ proposalId: value.proposalId, series:value.series,blocks:value.blocks,standaloneBlocks:value.standaloneBlocks??[] }:{ proposalId: value.proposalId, blocks: value.blocks }) });
      const body = await response.json() as { registered?: Array<{ title: string }>; error?: string; conflicts?: unknown[] };
      if (!response.ok) throw new Error(body.error ?? "登録できませんでした");
      setMessage(recurring?`${body.registered?.length ?? 0}種類の定期予定をGoogle Calendarへ登録しました。`:`${body.registered?.length ?? 0}件をGoogle Calendarへ登録しました。`);
      await onRegistered(allBlocks);
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
      if (autoRegister && body.calendarConnected && body.writeMode !== "readonly" && (body.blocks.length || (body.standaloneBlocks?.length ?? 0))) await registerPlan(body);
    } catch (error) { setMessage(error instanceof Error ? error.message : "提案を作成できませんでした"); }
    finally { setLoading(false); }
  }

  return <section className="card ai-planner">
    <div className="eyebrow">AI Schedule</div>
    <h2><Sparkles size={20}/> 目標から予定を自動提案</h2>
    <p className="muted">面接対策、試験勉強、提出準備などを作業へ分解します。複数の予定・変更・キャンセルが混ざった雑多な文章もまとめて解釈し、末尾の項目も含めてすべて拾います。既存予定の空き時間へ無理のない範囲で配置します。</p>
    <div className="field"><label>やりたいこと・確定した予定</label><textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="例：7月30日に面接が決まった。企業研究、想定質問の整理、模擬面接を準備したい。あと来週の飲み会はキャンセルして、3時のMTGは4時に変更して"/></div>
    <div className="planner-fields"><div className="field"><label>締切・本番日時（任意）</label><input type="datetime-local" value={deadline} onChange={(event) => setDeadline(event.target.value)}/></div><div className="field"><label>提案する期間</label><select value={horizon} onChange={(event) => setHorizon(Number(event.target.value))}><option value="7">7日</option><option value="14">14日</option><option value="30">30日</option><option value="60">60日</option></select></div></div>
    <label className="planner-check"><input type="checkbox" checked={autoRegister} disabled={!connected} onChange={(event) => setAutoRegister(event.target.checked)}/> 提案後、そのままGoogle Calendarへ登録する</label>
    {!connected && <p className="muted">Google Calendar未接続でも提案は作れます。登録するには先にCalendarを接続してください。</p>}
    <button className="button" disabled={loading || !text.trim()} onClick={() => void propose()}><Sparkles size={17}/>{loading ? "空き時間を確認中…" : "AIに予定を提案してもらう"}</button>
    {message && <p role="status" className="planner-message">{message}</p>}
    {proposal && <div className="planner-result">
      <div><span className="pill">{proposal.proposalKind==="sleep_schedule"?"睡眠設定 + 起床からの逆算":proposal.proposalKind==="morning_routine"?(proposal.aiMode==="openai"?"AIルーティン提案 + 睡眠優先の時刻計算":"標準ルーティン + 睡眠優先の時刻計算"):proposal.proposalKind==="flexible_event"?"候補日から空き時間を自動選定":proposal.proposalType==="rough_plan"?"AIが複数項目を解釈 + 現実的な空き時間配置":proposal.aiMode === "openai" ? "AI分解 + 時間計算" : proposal.aiMode==="hybrid"?"定期予定を認識 + 安全な時刻計算":"ルールベース分解 + 時間計算"}</span><h3>{proposal.goalTitle}</h3><p className="muted">{proposal.summary}</p>{proposal.recurrenceLabel&&<span className="pill">{proposal.recurrenceLabel}</span>}</div>
      {(() => { const previewBlocks=[...proposal.blocks,...(proposal.standaloneBlocks??[])].sort((a,b)=>a.startsAt.localeCompare(b.startsAt)); return previewBlocks.length ? <><div className="planner-blocks">{previewBlocks.slice(0,12).map((block) => <article key={block.id} className="planner-block"><div className="planner-date">{format(new Date(block.startsAt), "M/d (E)", { locale: ja })}</div><div><strong>{block.title}</strong><div>{format(new Date(block.startsAt), "H:mm")}–{format(new Date(block.endsAt), "H:mm")}</div><small className="muted">{block.reason}</small></div></article>)}</div>{previewBlocks.length>12&&<p className="muted">ほか {previewBlocks.length-12}件 · Google Calendarには期間内のすべてを登録します。</p>}</> : (proposal.proposalType!=="rough_plan"||!((proposal.updates?.length??0)||(proposal.deletes?.length??0))) && <p>配置できる時間が見つかりませんでした。</p>; })()}
      {(proposal.updates?.length||proposal.deletes?.length) ? <div className="planner-blocks">
        {proposal.updates?.map((item,index) => <UpdateCard key={`update-${index}`} item={item} connected={proposal.calendarConnected} writeMode={proposal.writeMode} onDone={() => onCalendarChanged?.()}/>)}
        {proposal.deletes?.map((item,index) => <DeleteCard key={`delete-${index}`} item={item} connected={proposal.calendarConnected} writeMode={proposal.writeMode} onDone={() => onCalendarChanged?.()}/>)}
      </div> : null}
      {[...proposal.warnings, ...proposal.assumptions].map((warning) => <p className="muted planner-note" key={warning}>※ {warning}</p>)}
      {proposal.unscheduled.map((item) => <p className="planner-note" key={`${item.title}-${item.minutes}`}>未配置：{item.title}（{item.minutes}分）</p>)}
      {proposal.calendarConnected && proposal.writeMode !== "readonly" && (proposal.blocks.length > 0 || (proposal.standaloneBlocks?.length ?? 0) > 0) && !autoRegister && <button className="button" disabled={registering} onClick={() => void registerPlan(proposal)}><CalendarCheck size={18}/>{registering ? "登録中…" : "この提案をGoogle Calendarに登録"}</button>}
      {proposal.writeMode === "readonly" && <p className="planner-note">Calendarが読み取り専用のため、提案だけ表示しています。</p>}
      {message.includes("登録しました") && <p className="planner-success"><Check size={17}/> 登録済み</p>}
    </div>}
  </section>;
}

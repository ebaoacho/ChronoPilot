"use client";

import { useEffect, useMemo, useState } from "react";
import { Bot, LocateFixed, MapPin, MessageCircle, Send, X } from "lucide-react";
import type { PlanBlock, TaskInput } from "@/lib/domain/types";
import type { LifeCoachResult } from "@/lib/domain/life-coach";
import type { z } from "zod";
import type { routeEstimateSchema } from "@/lib/domain/schemas";

type Message = { role: "user" | "assistant"; content: string };
type RouteEstimate = z.infer<typeof routeEstimateSchema>;
type CoachResponse = LifeCoachResult & { aiMode: "openai" | "fallback" };

const examples = [
  "今から30分ゲームしていい？",
  "急に外出することになった。予定に間に合う？",
  "タバコを吸いたい。今吸うと予定に影響する？"
];

export function LifeCoachChat({ blocks, tasks, freeMinutes }: { blocks: PlanBlock[]; tasks: TaskInput[]; freeMinutes: number }) {
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
    setLoading(true); setText(""); setResult(undefined);
    const userMessage: Message = { role: "user", content };
    const nextMessages = [...messages, userMessage].slice(-20);
    setMessages(nextMessages);
    try {
      const route = await getRoute();
      const response = await fetch("/api/ai/chat", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.slice(-12), now: new Date().toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Tokyo",
          blocks: blocks.map(({ title, kind, startsAt, endsAt, fixed }) => ({ title, kind, startsAt, endsAt, fixed })),
          tasks: tasks.map(({ title, estimateMinutes, priority, required }) => ({ title, estimateMinutes, priority, required })),
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

  if (!open) return <button className="coach-launch" onClick={() => setOpen(true)}><MessageCircle size={20}/> もう一人の私に相談</button>;
  return <section className="card coach" aria-label="AIライフコーチ">
    <div className="coach-header"><div><div className="eyebrow">Life Coach</div><h2><Bot size={20}/> もう一人の私</h2></div><button className="icon-button" aria-label="閉じる" onClick={() => setOpen(false)}><X size={20}/></button></div>
    <p className="muted coach-intro">今していいこと、予定への影響、急な外出を相談できます。時間計算は予定データから行い、AIに推測させません。</p>
    <div className="coach-examples">{examples.map((example) => <button key={example} onClick={() => void send(example)}>{example}</button>)}</div>
    {messages.length > 0 && <div className="coach-messages" aria-live="polite">{messages.slice(-6).map((message, index) => <div key={`${message.role}-${index}`} className={`coach-message ${message.role}`}>{message.content}</div>)}</div>}
    {result && <div className="coach-result"><span className="pill">{verdict}</span>{result.impacts.map((impact) => <div className="coach-impact" key={`${impact.label}-${impact.after}`}><strong>{impact.label}</strong><span>{impact.before}{impact.after ? ` → ${impact.after}` : ""}</span></div>)}{result.options.map((option) => <div className="coach-option" key={option.label}><strong>{option.recommended ? "おすすめ：" : "候補："}{option.label}</strong><span>{option.description}</span></div>)}<small className="muted">{result.aiMode === "openai" ? "AIが表現と選択肢を生成・時間判定は計算ロジック" : "安全なルールベース応答"}</small></div>}
    <details className="route-controls"><summary><MapPin size={16}/> 移動時間も調べる</summary><div className="field"><label>行き先</label><input value={destination} onChange={(event) => setDestination(event.target.value)} placeholder="例：東京駅、大学名、住所"/></div><div className="route-grid"><div className="field"><label>移動手段</label><select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}><option value="TRANSIT">公共交通</option><option value="DRIVE">車</option><option value="WALK">徒歩</option><option value="BICYCLE">自転車</option></select></div><div className="field"><label>所要時間（手入力・任意）</label><input type="number" min="1" max="1440" value={manualMinutes} onChange={(event) => setManualMinutes(event.target.value)} placeholder="分"/></div></div><button className="button secondary" onClick={locate}><LocateFixed size={17}/> 現在地を使う</button>{routeNote && <p className="muted">{routeNote}</p>}</details>
    <div className="coach-compose"><textarea aria-label="相談内容" value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="例：今からゲームしていい？"/><button className="button" disabled={loading || !text.trim()} onClick={() => void send()}><Send size={18}/>{loading ? "考え中" : "相談"}</button></div>
  </section>;
}

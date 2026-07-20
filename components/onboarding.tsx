"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type OnboardingInitialValues = {
  targetSleepMinutes: number;
  morningPrepMinutes: number;
  defaultTravelMinutes: number;
  weekdayGameMinutes: number;
  holidayGameMinutes: number;
  engineerVision: string;
};

export const defaultOnboardingValues: OnboardingInitialValues = {
  targetSleepMinutes: 420,
  morningPrepMinutes: 52,
  defaultTravelMinutes: 30,
  weekdayGameMinutes: 90,
  holidayGameMinutes: 150,
  engineerVision: "大規模なAIサービスを設計し、継続的に価値を届けられるエンジニア"
};

export function Onboarding({ show, initial = defaultOnboardingValues }: { show: boolean; initial?: OnboardingInitialValues }) {
  const router = useRouter();
  const [open, setOpen] = useState(show);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!open) return null;

  async function submit(form: FormData) {
    setBusy(true);
    setError("");
    try {
      const body = {
        targetSleepMinutes: Number(form.get("sleep")),
        morningPrepMinutes: Number(form.get("morning")),
        defaultTravelMinutes: Number(form.get("travel")),
        weekdayGameMinutes: Number(form.get("weekdayGame")),
        holidayGameMinutes: Number(form.get("holidayGame")),
        engineerVision: String(form.get("vision"))
      };
      const response = await fetch("/api/onboarding", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as { saved?: boolean; completed?: boolean; error?: string };
      if (!response.ok || !result.saved || !result.completed) throw new Error(result.error ?? "設定を保存できませんでした");
      setOpen(false);
      router.refresh();
    } catch (value) {
      setError(value instanceof Error ? value.message : "設定を保存できませんでした");
    } finally {
      setBusy(false);
    }
  }

  return <div role="dialog" aria-modal="true" aria-labelledby="onboarding-title" style={{ position: "fixed", zIndex: 100, inset: 0, background: "rgb(0 0 0 / .65)", overflow: "auto", padding: 16 }}>
    <form action={submit} className="card" style={{ maxWidth: 580, margin: "30px auto" }}>
      <div className="eyebrow">3分で開始</div>
      <h1 id="onboarding-title">ChronoPilotをあなた向けに</h1>
      <p className="muted">この設定はログイン中のGoogleアカウント専用として保存され、次回ログイン後も引き継がれます。</p>
      <div className="metric-grid">
        <div className="field"><label>通常の睡眠（分）</label><input name="sleep" type="number" min="300" max="720" defaultValue={initial.targetSleepMinutes} required/></div>
        <div className="field"><label>朝の準備（分）</label><input name="morning" type="number" min="10" max="240" defaultValue={initial.morningPrepMinutes} required/></div>
        <div className="field"><label>よく行く場所への移動（分）</label><input name="travel" type="number" min="0" max="360" defaultValue={initial.defaultTravelMinutes} required/></div>
        <div className="field"><label>平日のゲーム（分）</label><input name="weekdayGame" type="number" min="0" max="480" defaultValue={initial.weekdayGameMinutes} required/></div>
        <div className="field"><label>休日のゲーム（分）</label><input name="holidayGame" type="number" min="0" max="720" defaultValue={initial.holidayGameMinutes} required/></div>
      </div>
      <div className="field"><label>目指すエンジニア像</label><textarea name="vision" defaultValue={initial.engineerVision} required/></div>
      {error && <p role="alert" style={{ color: "var(--warn)" }}>{error}<br/><span className="muted">入力画面は閉じていません。通信とSupabase Migrationを確認してください。</span></p>}
      <button className="button" disabled={busy}>{busy ? "保存中…" : "この設定で始める"}</button>
    </form>
  </div>;
}

import type { z } from "zod";
import { lifeCoachInputSchema, lifeCoachResultSchema } from "@/lib/domain/schemas";

export type LifeCoachInput = z.infer<typeof lifeCoachInputSchema>;
export type LifeCoachResult = z.infer<typeof lifeCoachResultSchema>;

function latestUserText(input: LifeCoachInput) {
  return [...input.messages].reverse().find((message) => message.role === "user")?.content ?? "";
}

function nextBlock(input: LifeCoachInput) {
  const now = new Date(input.now).getTime();
  return input.blocks
    .filter((block) => new Date(block.endsAt).getTime() > now)
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())[0];
}

function requestedMinutes(text: string, fallback: number) {
  const match = text.match(/(\d{1,3})\s*分/);
  return match ? Math.max(1, Number(match[1])) : fallback;
}

function minutesUntil(iso: string, now: string) {
  return Math.max(0, Math.floor((new Date(iso).getTime() - new Date(now).getTime()) / 60000));
}

function formatTime(iso: string, timezone: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: timezone
  }).format(new Date(iso));
}

export function buildFallbackCoachAnswer(input: LifeCoachInput): LifeCoachResult {
  const text = latestUserText(input);
  const upcoming = nextBlock(input);
  const available = upcoming ? minutesUntil(upcoming.startsAt, input.now) : (input.freeMinutes ?? 60);
  const upcomingText = upcoming
    ? `${formatTime(upcoming.startsAt, input.timezone)}から「${upcoming.title}」`
    : "この後の固定予定は見つかっていません";
  const isTravel = /(外出|行かな|行きたい|行く|向かう|まで.*(?:何分|時間)|移動|到着|出発)/.test(text);
  const isSmoking = /(タバコ|たばこ|煙草|吸いた)/.test(text);
  const isBath = /(風呂|入浴|シャワー)/.test(text);
  const isPermission = /(していい|やっていい|できる|始めていい|遊んでいい)/.test(text);

  if (isTravel) {
    if (!input.route) {
      return {
        reply: `場所と移動手段が分かれば、現在地からの所要時間と${upcomingText}への影響を一緒に確認できます。移動時間は推測せず、経路検索の結果を使います。`,
        intent: "travel", verdict: "need_more_info", confidence: "high",
        impacts: upcoming ? [{ label: "次の予定", before: upcomingText, severity: "info" }] : [],
        options: [], questions: ["行き先と移動手段を教えてください。"], assumptions: []
      };
    }
    const buffer = available - input.route.durationMinutes;
    const canGo = !upcoming || buffer >= 10;
    return {
      reply: `${input.route.destination}までは約${input.route.durationMinutes}分です。${upcoming ? `次の予定までの余裕は約${Math.max(0, buffer)}分です。` : "この後の予定との衝突は見つかりませんでした。"}`,
      intent: "travel", verdict: canGo ? "yes" : "not_now", confidence: "high",
      estimatedMinutes: input.route.durationMinutes,
      impacts: upcoming ? [{ label: upcoming.title, before: formatTime(upcoming.startsAt, input.timezone), after: buffer >= 0 ? `余裕 ${buffer}分` : `${Math.abs(buffer)}分遅れる見込み`, severity: canGo ? "info" : "warning" }] : [],
      options: canGo ? [{ label: "出発する", description: "10分以上の余裕を残せます。", recommended: true }] : [{ label: "予定を調整する", description: "睡眠を削らず、次の予定か外出時刻を調整します。", recommended: true }],
      questions: [], assumptions: [`経路サービスの${input.route.mode}による所要時間を使用しています。`]
    };
  }

  if (isSmoking) {
    const minutes = requestedMinutes(text, 10);
    const fits = available >= minutes + 5;
    return {
      reply: fits
        ? `${minutes}分の休憩を取っても、${upcomingText}まで約${available - minutes}分残ります。予定面では可能です。喫煙を勧める判断ではなく、時間への影響だけを答えています。`
        : `${upcomingText}まで約${available}分なので、今${minutes}分使うと余裕がほぼなくなります。まず予定を始め、区切りで休憩する方が安全です。`,
      intent: "wellbeing", verdict: fits ? "yes_with_limit" : "not_now", confidence: "medium",
      estimatedMinutes: minutes,
      impacts: upcoming ? [{ label: upcoming.title, before: `余裕 ${available}分`, after: `余裕 ${Math.max(0, available - minutes)}分`, severity: fits ? "info" : "warning" }] : [],
      options: fits
        ? [{ label: `${minutes}分で戻る`, description: "終了時刻を決めて短い休憩として扱います。", recommended: true }, { label: "別の休憩にする", description: "水分補給や短い散歩に置き換えます。", recommended: false }]
        : [{ label: "予定を先に始める", description: "最初の区切りで休憩を再検討します。", recommended: true }],
      questions: [], assumptions: [`休憩を${minutes}分として計算しました。`]
    };
  }

  if (isBath) {
    const now = new Date(input.now).getTime();
    const minimumStart = /明日/.test(text) ? now + 8 * 60 * 60 * 1000 : now;
    const sleep = input.blocks
      .filter((block) => (block.kind === "sleep" || /睡眠|就寝/.test(block.title)) && new Date(block.startsAt).getTime() > minimumStart)
      .sort((left, right) => left.startsAt.localeCompare(right.startsAt))[0];
    const bathMinutes = requestedMinutes(text, 30);
    if (sleep) {
      const bathEndsAt = new Date(new Date(sleep.startsAt).getTime() - 30 * 60000);
      const bathStartsAt = new Date(bathEndsAt.getTime() - bathMinutes * 60000);
      return {
        reply: `明日の就寝予定が${formatTime(sleep.startsAt, input.timezone)}なので、${formatTime(bathStartsAt.toISOString(), input.timezone)}〜${formatTime(bathEndsAt.toISOString(), input.timezone)}に入る案がよさそうです。就寝前に30分の余裕を残します。明日の予定が変われば、その時点で再計画できます。`,
        intent: "wellbeing", verdict: "yes_with_limit", confidence: "medium", estimatedMinutes: bathMinutes,
        impacts: [{ label: "就寝", before: formatTime(sleep.startsAt, input.timezone), after: "変更なし", severity: "info" }],
        options: [{ label: `${formatTime(bathStartsAt.toISOString(), input.timezone)}に入浴`, description: `${bathMinutes}分で終え、就寝前の余裕を確保します。`, recommended: true }],
        questions: [], assumptions: [`入浴時間を${bathMinutes}分、就寝前の余裕を30分として計算しました。`]
      };
    }
    return {
      reply: "明日の就寝予定がまだ見つからないため、入浴時刻を断定できません。希望する就寝時刻が分かれば、入浴時間と就寝前の余裕から逆算します。",
      intent: "wellbeing", verdict: "need_more_info", confidence: "medium", impacts: [], options: [],
      questions: ["明日は何時に寝たいですか？"], assumptions: [`入浴時間を${bathMinutes}分として仮定します。`]
    };
  }

  if (isPermission) {
    const minutes = requestedMinutes(text, 30);
    const fits = available >= minutes + 10;
    return {
      reply: fits
        ? `いいと思います。${minutes}分で切り上げれば、${upcomingText}まで10分以上の余裕を残せます。`
        : `${upcomingText}まで約${available}分です。${minutes}分すべては難しいので、${Math.max(0, available - 10)}分までにするか、予定の後へ回すのがよさそうです。`,
      intent: "permission", verdict: fits ? "yes_with_limit" : "not_now", confidence: "high",
      estimatedMinutes: minutes,
      impacts: upcoming ? [{ label: upcoming.title, before: `余裕 ${available}分`, after: `余裕 ${Math.max(0, available - minutes)}分`, severity: fits ? "info" : "warning" }] : [],
      options: fits ? [{ label: `${minutes}分やる`, description: "終了時刻を決めて始めます。", recommended: true }] : [{ label: "短縮する", description: `${Math.max(0, available - 10)}分以内にします。`, recommended: true }, { label: "後へ回す", description: "次の予定の後に再計画します。", recommended: false }],
      questions: [], assumptions: [`希望時間を${minutes}分として計算しました。`]
    };
  }

  return {
    reply: `話してくれてありがとう。${upcomingText}です。何をしたいかと、何分くらい使いたいかを教えてくれれば、今日の計画を崩さない選択肢を一緒に考えます。`,
    intent: /(つら|しんど|疲れ|嘆)/.test(text) ? "vent" : "general",
    verdict: "need_more_info", confidence: "medium", impacts: [], options: [],
    questions: ["今からしたいことと、使いたい時間を教えてください。"], assumptions: []
  };
}

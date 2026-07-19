type CoachBlockContext = { startsAt: string; endsAt: string };

export function selectCoachBlocks<T extends CoachBlockContext>(blocks: T[], nowIso: string, limit = 80) {
  const now = new Date(nowIso).getTime();
  const recentThreshold = now - 60 * 60 * 1000;
  return blocks
    .filter((block) => Number.isFinite(new Date(block.startsAt).getTime()) && new Date(block.endsAt).getTime() > recentThreshold)
    .sort((a, b) => {
      const aStart = new Date(a.startsAt).getTime();
      const bStart = new Date(b.startsAt).getTime();
      const aScore = aStart <= now && new Date(a.endsAt).getTime() > now ? -1 : Math.abs(aStart - now);
      const bScore = bStart <= now && new Date(b.endsAt).getTime() > now ? -1 : Math.abs(bStart - now);
      return aScore - bScore || aStart - bStart;
    })
    .slice(0, limit)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

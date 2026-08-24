// Level-ladder math, shared between the top bar and the Achievements screen. Tracking itself
// (claims, badges, check-ins) always goes through the API now -- there is no local/offline
// tracking mode, so this file no longer needs a client-side badge-evaluation mirror.

export const LEVEL_LADDER = [
  { level: 0, name: "Bystander", min: 0 },
  { level: 1, name: "Rookie", min: 1 },
  { level: 2, name: "Starter", min: 3 },
  { level: 3, name: "Mover", min: 6 },
  { level: 4, name: "Switcher", min: 10 },
  { level: 5, name: "Divester", min: 15 },
  { level: 6, name: "Legend", min: 25 },
  { level: 7, name: "Untouchable", min: 40 },
];

export function computeLevel(totalClaimed) {
  let current = LEVEL_LADDER[0];
  for (const l of LEVEL_LADDER) if (totalClaimed >= l.min) current = l;
  const next = LEVEL_LADDER.find((l) => l.min > totalClaimed);
  return {
    level: current.level,
    name: current.name,
    actionsToNext: next ? next.min - totalClaimed : 0,
    nextName: next?.name ?? null,
  };
}

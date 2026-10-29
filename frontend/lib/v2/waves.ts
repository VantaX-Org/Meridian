import type { Landscape, LandscapeCell, Verdict } from "@/lib/api/v2/types";
import type { MigrationWave } from "@/types/api";

/**
 * Migration waves on the landscape. A wave lists the objects (modules) it moves; an object belongs to the first wave
 * that lists it (the editor keeps it in exactly one). The wave's counts are the verdicts of those objects' cells in
 * the systems on screen, so they add up to the matrix beside them.
 */
export interface WaveGroup {
  wave: MigrationWave | null;
  /** Modules of the wave that the landscape has, in the landscape's object order. */
  modules: string[];
  counts: Record<Verdict, number>;
}

const zero = (): Record<Verdict, number> => ({ go: 0, "at-risk": 0, "no-go": 0 });

/** Waves in the order a programme reads them: dated ones by date, then the undated ones in their given order. */
export function sortWaves(waves: readonly MigrationWave[]): MigrationWave[] {
  return [...waves].sort((a, b) => (a.target_date && b.target_date ? a.target_date.localeCompare(b.target_date) : a.target_date ? -1 : b.target_date ? 1 : 0));
}

/** The wave an object is in, or null. */
export function waveOf(module: string, waves: readonly MigrationWave[]): MigrationWave | null {
  return sortWaves(waves).find((w) => w.modules.includes(module)) ?? null;
}

/** Groups the landscape's objects by wave; objects in no wave come last under a null wave. Empty waves are kept. */
export function groupByWave(landscape: Landscape, waves: readonly MigrationWave[], cells: readonly LandscapeCell[]): WaveGroup[] {
  const order = landscape.objects.map((o) => o.module);
  const taken = new Set<string>();
  const groups: WaveGroup[] = sortWaves(waves).map((wave) => {
    const modules = order.filter((m) => wave.modules.includes(m) && !taken.has(m));
    modules.forEach((m) => taken.add(m));
    const counts = zero();
    cells.filter((c) => modules.includes(c.module)).forEach((c) => (counts[c.verdict] += 1));
    return { wave, modules, counts };
  });
  const rest = order.filter((m) => !taken.has(m));
  if (rest.length) {
    const counts = zero();
    cells.filter((c) => rest.includes(c.module)).forEach((c) => (counts[c.verdict] += 1));
    groups.push({ wave: null, modules: rest, counts });
  }
  return groups;
}

/** The wave the programme lead should look at next: the earliest dated wave that is not signed off, else the first unsigned one. */
export function nextWave(waves: readonly MigrationWave[]): MigrationWave | null {
  const open = sortWaves(waves).filter((w) => !w.signed_off_at);
  return open.find((w) => w.target_date) ?? open[0] ?? null;
}

/** Days from `now` to a `YYYY-MM-DD` date (negative when past), or null. */
export function daysUntil(date: string | null, now: number = Date.now()): number | null {
  if (!date) return null;
  const t = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(t) ? Math.round((t - now) / 86_400_000) || 0 : null;
}

/**
 * Applies "object X goes to wave W" choices on top of the current waves and returns the module list of every wave that
 * changed. `choice` maps module -> wave id, or "" for no wave. An object is removed from every other wave.
 */
export function reassign(waves: readonly MigrationWave[], choice: Readonly<Record<string, string>>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const w of waves) {
    const kept = w.modules.filter((m) => !(m in choice));
    const added = Object.entries(choice).filter(([, id]) => id === w.id).map(([m]) => m);
    const next = [...kept, ...added.filter((m) => !kept.includes(m))];
    const same = next.length === w.modules.length && next.every((m) => w.modules.includes(m));
    if (!same) out[w.id] = next;
  }
  return out;
}

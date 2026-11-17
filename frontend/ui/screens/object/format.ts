import type { VersionHead } from "@/lib/api/v2/runs";
import { f1, int } from "@/lib/v2/score";

const SHORT = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

/** A score with one decimal, the decimal left off when it is zero ("77", "77.5"). */
export const score = (n: number): string => {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? f1(r).replace(/[.,]0$/, "") : f1(r);
};

/** "+6", "-2.5", "0". */
export function signed(n: number): string {
  const r = Math.round(n * 10) / 10;
  return r > 0 ? `+${score(r)}` : r < 0 ? `-${score(-r)}` : "0";
}

/** 1234567 reads "1.2M"; below 10 000 it stays whole. */
export const compactCount = (n: number): string => (Math.abs(n) < 10_000 ? int(n) : SHORT.format(n));

/** The shown score of one object in a run (after any cap), or null when the run did not score it. */
export function dqsOf(h: VersionHead | null | undefined, module: string): number | null {
  const s = h?.dqs_summary?.[module];
  return s ? (s.composite_score ?? s.raw_score ?? null) : null;
}

const KEY = (system: string, module: string) => `nx-run:${system}:${module}`; // i18n-ignore

export function rememberRun(system: string, module: string, id: string | null): void {
  try {
    if (id) sessionStorage.setItem(KEY(system, module), id);
    else sessionStorage.removeItem(KEY(system, module));
  } catch {
    // Storage blocked: the address still carries the run.
  }
}

export function recalledRun(system: string, module: string): string | null {
  try {
    return sessionStorage.getItem(KEY(system, module));
  } catch {
    return null;
  }
}

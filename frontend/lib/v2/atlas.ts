import type { TimelineRun } from "@/lib/api/v2/runs";

/**
 * The landscape atlas replays the runs of every system in the order they ran. Each frame is the landscape as it stood
 * right after one run: every object at the score of its own latest run so far, so an object a run did not touch keeps
 * its last score. `delta` holds the change for the objects the frame's run scored, against their previous score.
 */

export interface AtlasFrame {
  run: TimelineRun;
  /** Score by `system|module` after this run; absent until a run first scores the object. */
  scores: Map<string, number | null>;
  /** Points moved by this run, for the objects it scored and had a score before. */
  delta: Map<string, number>;
}

export const atlasKey = (system: string | null, module: string): string => `${system ?? ""}|${module}`;

export function framesOf(timelines: readonly (readonly TimelineRun[])[]): AtlasFrame[] {
  const runs = timelines.flat().filter((r) => r.run_at != null);
  runs.sort((a, b) => (a.run_at as string).localeCompare(b.run_at as string));
  const state = new Map<string, number | null>();
  return runs.map((run) => {
    const delta = new Map<string, number>();
    for (const [module, o] of Object.entries(run.objects)) {
      const key = atlasKey(run.system_id, module);
      const prev = state.get(key);
      if (o.score != null && prev != null) delta.set(key, o.score - prev);
      state.set(key, o.score);
    }
    return { run, scores: new Map(state), delta };
  });
}

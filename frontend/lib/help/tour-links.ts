/**
 * Fills the tokens in a tour step's `href` (see lib/help/tours.ts). Each token
 * is looked up lazily, so a tour that never uses `{system}` never fetches
 * systems. A token that cannot be filled makes the whole step resolve to
 * `null`, and the tour skips it.
 */
export interface TourLinkSources {
  /** The selected run id, else the newest finished run. */
  run: () => Promise<string | null>;
  /** First system id. */
  system: () => Promise<string | null>;
  /** The object module with the most failing checks. */
  object: () => Promise<string | null>;
  /** First process (level 1) with a completed discovery run, on any system. */
  process: () => Promise<{ l1: string; runId: string; systemId: string } | null>;
}

const TOKEN = /\{(run|system|object|l1|l1run)\}/g;

export async function resolveTourHref(href: string, sources: TourLinkSources): Promise<string | null> {
  const used = new Set<string>();
  for (const m of href.matchAll(TOKEN)) used.add(m[1]);
  if (used.size === 0) return href;

  const values: Record<string, string> = {};
  if (used.has("run")) {
    const v = await sources.run();
    if (v === null) return null;
    values.run = v;
  }
  if (used.has("object")) {
    const v = await sources.object();
    if (v === null) return null;
    values.object = v;
  }
  if (used.has("l1") || used.has("l1run")) {
    const p = await sources.process();
    if (p === null) return null;
    values.l1 = p.l1;
    values.l1run = p.runId;
    // A process step's `{system}` must be the system the process was found on.
    values.system = p.systemId;
  } else if (used.has("system")) {
    const v = await sources.system();
    if (v === null) return null;
    values.system = v;
  }
  return href.replace(TOKEN, (_, key: string) => encodeURIComponent(values[key]));
}

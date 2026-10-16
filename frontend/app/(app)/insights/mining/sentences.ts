import { plural } from "@/lib/format";

/** The mining header's "why" sentence, with no zero counts read out as facts. */
export function miningWhy(links: number, inferred: number, patterns: number): string {
  const mined = patterns ? `${plural(patterns, "pattern is", "patterns are")} mined` : "no pattern is mined yet";
  if (!links) return patterns ? `${plural(patterns, "pattern is", "patterns are")} mined` : "Nothing is mined yet";
  if (!inferred) return `Every link is declared and ${mined}`;
  return `${plural(inferred, "link is", "links are")} inferred and ${mined}`;
}

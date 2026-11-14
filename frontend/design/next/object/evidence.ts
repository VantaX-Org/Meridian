/** Aletheia's findings of one object and the one sentence the object page quotes from them. Nothing is made up: no origin, no sentence. */
import { useQuery } from "@tanstack/react-query";
import { getFindings, type AletheiaFinding } from "@/lib/api/v2/insights";
import { useFixture } from "@/lib/api/v2/fixture";
import { t } from "@/lib/v2/i18n";
import { int } from "@/lib/v2/score";

export function useFindings(module: string) {
  const fx = useFixture();
  return useQuery({ queryKey: ["aletheia-found", fx, module], queryFn: () => getFindings(module || undefined), staleTime: 60_000 });
}

/** The worst finding that names where its failures come from, in a sentence. Null when none does. */
export function originSentence(findings: AletheiaFinding[]): string | null {
  const f = [...findings].filter((x) => x.why.origin.top).sort((a, b) => b.affected - a.affected)[0];
  if (!f || !f.why.origin.top) return null;
  const share = f.why.origin.share;
  return share !== null && share !== undefined
    ? t("Most of the {name} failures ({n} records) come from {top}, {share}% of them.", { name: f.name, n: int(f.affected), top: f.why.origin.top, share: Math.round(share * 100) })
    : t("The {name} failures ({n} records) come from {top}.", { name: f.name, n: int(f.affected), top: f.why.origin.top });
}

/** A confidence as a word and a number: "High, 92%". */
export function confidenceWord(c: AletheiaFinding["confidence"]): string | null {
  if (!c) return null;
  const pct = Math.round(c.value * 100);
  return `${pct >= 90 ? t("High") : pct >= 70 ? t("Medium") : t("Low")}, ${pct}%`;
}

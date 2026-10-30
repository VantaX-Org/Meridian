import type { Verdict } from "@/lib/api/v2/types";
import { t } from "@/lib/v2/i18n";
import { f1, int, VERDICT_LABEL } from "@/lib/v2/score";
import { SeverityMark, VerdictMark, type SeverityKey } from "../marks";
import type { StackPart } from "./StackedBar";

/**
 * The parts the screens stack, with their order, colour token, mark and words in one place: findings by severity (the
 * ordinal severity scale) and objects by verdict (the semantic hues). A screen passes counts; the chart draws.
 */
const SEVERITIES: readonly { key: SeverityKey; colour: string; label: () => string }[] = [
  { key: "critical", colour: "--m2-sev-crit", label: () => t("Critical") },
  { key: "high", colour: "--m2-sev-high", label: () => t("High") },
  { key: "medium", colour: "--m2-sev-med", label: () => t("Medium") },
  { key: "low", colour: "--m2-sev-low", label: () => t("Low") },
];

const share = (n: number, total: number): string => f1(total > 0 ? (n / total) * 100 : 0);

export function severityParts(counts: Partial<Record<string, number>>): StackPart[] {
  const total = SEVERITIES.reduce((n, s) => n + (counts[s.key] ?? 0), 0);
  return SEVERITIES.map((s) => {
    const value = counts[s.key] ?? 0;
    return { key: s.key, label: s.label(), value, colour: s.colour, mark: <SeverityMark severity={s.key} />, title: t("{severity}: {n} {count, plural, one {finding} other {findings}}, {share} percent", { severity: s.label(), n: int(value), count: value, share: share(value, total) }) };
  });
}

const VERDICTS: readonly { key: Verdict; colour: string }[] = [
  { key: "no-go", colour: "--m2-fail" },
  { key: "at-risk", colour: "--m2-warn" },
  { key: "go", colour: "--m2-pass" },
];

export function verdictParts(counts: Partial<Record<Verdict, number>>): StackPart[] {
  const total = VERDICTS.reduce((n, v) => n + (counts[v.key] ?? 0), 0);
  return VERDICTS.map((v) => {
    const value = counts[v.key] ?? 0;
    return { key: v.key, label: VERDICT_LABEL[v.key], value, colour: v.colour, mark: <VerdictMark verdict={v.key} />, title: t("{verdict}: {n} {count, plural, one {object} other {objects}}, {share} percent", { verdict: VERDICT_LABEL[v.key], n: int(value), count: value, share: share(value, total) }) };
  });
}


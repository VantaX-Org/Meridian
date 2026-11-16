"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { Verdict } from "@/lib/api/v2/types";
import { useOpenItem, type OpenKind } from "@/lib/v2/hooks";
import { DQ_WORD } from "@/lib/v2/process-tree";
import { f1, VERDICT_LABEL } from "@/lib/v2/score";
import { t } from "@/lib/v2/i18n";
import { Chip, ProgressBar } from "../../kit";

/** A value that is not there, with the reason on hover. */
export function Dash({ why }: { why?: string }) {
  return (
    <span className="nx-tg-dash" title={why} aria-label={why ?? t("None")}>
      —
    </span>
  );
}

const VERDICT_TONE = { go: "good", "at-risk": "warn", "no-go": "bad" } as const;
export function VerdictChip({ verdict }: { verdict: Verdict }) {
  return <Chip tone={VERDICT_TONE[verdict]}>{VERDICT_LABEL[verdict]}</Chip>;
}

const SEV_TONE: Record<string, "bad" | "warn" | "neutral"> = { critical: "bad", high: "bad", medium: "warn" };
const SEV_LABEL: Record<string, () => string> = { critical: () => t("Critical"), high: () => t("High"), medium: () => t("Medium"), low: () => t("Low"), info: () => t("Info") };
export function SevChip({ severity }: { severity: string | null | undefined }) {
  if (!severity) return null;
  return <Chip tone={SEV_TONE[severity] ?? "neutral"}>{SEV_LABEL[severity]?.() ?? severity}</Chip>;
}

const DQ_TONE = { green: "good", amber: "warn", red: "bad" } as const;
export function DqChip({ dq }: { dq: keyof typeof DQ_TONE }) {
  return <Chip tone={DQ_TONE[dq]}>{DQ_WORD[dq]}</Chip>;
}

/** A rule id as a link with its name beside it. */
export function RuleLink({ id, name, severity }: { id: string; name?: string | null; severity?: string | null }) {
  const { hrefFor } = useOpenItem();
  return (
    <span className="nx-tg-rule">
      {severity ? <SevChip severity={severity} /> : null}
      <Link href={hrefFor({ kind: "rule", id })} className="nx-link nx-mono">
        {id}
      </Link>
      <span>{name || "—"}</span>
    </span>
  );
}

/** A plain link to an item the page knows how to open. */
export function ItemLink({ kind, id, children, className }: { kind: OpenKind; id: string; children?: ReactNode; className?: string }) {
  const { hrefFor } = useOpenItem();
  return (
    <Link href={hrefFor({ kind, id })} className={`nx-link${className ? ` ${className}` : ""}`}>
      {children ?? id}
    </Link>
  );
}

/** A 0..100 score as a short bar with its number. */
export function ScoreBar({ value, label, max = 100 }: { value: number | null | undefined; label: string; max?: number }) {
  if (value == null) return <Dash />;
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <span className="nx-tg-bar">
      <ProgressBar value={pct} label={`${label} ${f1(value)}`} text={<span className="nx-num">{f1(value)}</span>} />
    </span>
  );
}

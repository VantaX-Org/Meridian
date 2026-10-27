"use client";

import { Mono } from "@/design";
import { ddicRuleName, ruleWords, useRuleNames } from "@/lib/rule-name";

/**
 * A rule as a ledger names it: the check id and the rule's words (`useRuleWords`). The id alone when nothing names it.
 */
export function RuleCell({ id, fallback, className }: { id: string; fallback?: string | null; className?: string }) {
  const name = useRuleWords(id, fallback);
  return (
    <span className={`inline-flex min-w-0 items-baseline gap-2${className ? ` ${className}` : ""}`} title={name ?? undefined}>
      <Mono>{id}</Mono>
      {name ? <span className="m-ink-2 truncate">{name}</span> : null}
    </span>
  );
}

/** Only a rule's words (as `RuleCell` resolves them), for a place that shows the check id itself; nothing when unnamed. */
export function RuleName({ id, fallback, className = "m-ink-2" }: { id: string; fallback?: string | null; className?: string }) {
  const name = useRuleWords(id, fallback);
  return name ? <span className={className} title={name}>{name}</span> : null;
}

/**
 * A rule's words: the tenant's catalogue name (batched and cached per id by `useRuleNames`), else `fallback` (a name or
 * message the row already carries, never one that only repeats the id), else a DDIC check's own words (`ddicRuleName`).
 */
export function useRuleWords(id: string, fallback?: string | null): string | undefined {
  const ddic = ddicRuleName(id);
  const catalogue = useRuleNames(ddic ? [] : [id])(id);
  return (ddic ? undefined : catalogue) ?? ruleWords(id, fallback) ?? ddic ?? undefined;
}

"use client";

import Link from "next/link";
import { Mono } from "@/design";
import { useRuleWords } from "@/lib/rule-name";

/**
 * A rule as a ledger names it: the check id whole on its own line (never broken mid-id), the rule's words under it in
 * at most two lines, the full words in the title. Words by `useRuleWords` (lib/rule-name.ts `resolveRuleName`: the
 * catalogue name, else `fallback` (the finding's own message), else generated words). The id alone when nothing names it.
 */
export function RuleCell({ id, fallback, href, className }: {
  id: string;
  fallback?: string | null;
  /** When given, the id is a link (e.g. to the rule's failing records). */
  href?: string;
  className?: string;
}) {
  const name = useRuleWords(id, fallback);
  return (
    <span className={`flex min-w-0 flex-col${className ? ` ${className}` : ""}`} title={name ?? undefined} data-rule-cell="">
      <span className="whitespace-nowrap">
        {href ? (
          <Link href={href} className="underline-offset-2 hover:underline" onClick={(e) => e.stopPropagation()}><Mono>{id}</Mono></Link>
        ) : <Mono>{id}</Mono>}
      </span>
      {name ? <span className="m-ink-2 line-clamp-2 whitespace-normal [overflow-wrap:break-word]">{name}</span> : null}
    </span>
  );
}

/** Only a rule's words (as `RuleCell` resolves them), for a place that shows the check id itself; nothing when unnamed. */
export function RuleName({ id, fallback, className = "m-ink-2" }: { id: string; fallback?: string | null; className?: string }) {
  const name = useRuleWords(id, fallback);
  return name ? <span className={className} title={name}>{name}</span> : null;
}

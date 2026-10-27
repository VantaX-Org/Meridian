"use client";

import { Mono } from "@/design";
import { useRuleNames } from "@/lib/rule-name";

/** A rule as a ledger names it: the id and, once the rules list has loaded, its words (one shared, cached request). */
export function RuleCell({ id }: { id: string }) {
  const name = useRuleNames()(id);
  return (
    <span className="inline-flex min-w-0 items-baseline gap-2">
      <Mono>{id}</Mono>
      {name ? <span className="m-ink-2 truncate">{name}</span> : null}
    </span>
  );
}

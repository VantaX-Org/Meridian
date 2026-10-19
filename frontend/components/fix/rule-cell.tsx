"use client";

import { useQuery } from "@tanstack/react-query";
import { Mono } from "@/design";
import { getRules } from "@/lib/api/rules";
import { queryKeys } from "@/lib/query-keys";

/** A rule as a ledger names it: the id and, once the rules list has loaded, its words (one shared, cached request). */
export function RuleCell({ id }: { id: string }) {
  const rules = useQuery({
    queryKey: queryKeys.rules({ limit: 1000, purpose: "names" }),
    queryFn: () => getRules({ limit: 1000 }),
    staleTime: 10 * 60_000,
  });
  const name = rules.data?.rules.find((r) => r.id === id)?.name;
  return (
    <span className="inline-flex min-w-0 items-baseline gap-2">
      <Mono>{id}</Mono>
      {name ? <span className="m-ink-2 truncate">{name}</span> : null}
    </span>
  );
}

"use client";

import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { getRules } from "@/lib/api/rules";
import { queryKeys } from "@/lib/query-keys";

/**
 * DDIC conformance checks have no YAML rule, so the rule catalogue does not name them: their id says the table and the
 * kind of check (`DDIC-MARA-TYPE`), and the words are the check's own (checks/ddic_conformance.py `_KINDS`).
 */
const DDIC_KINDS: Record<string, string> = {
  TYPE: "Value does not match the field's SAP data type",
  LENGTH: "Value exceeds the field's SAP length or precision",
  CASE: "Lower-case value in an upper-case SAP field",
  FIXED_VALUE: "Value is not one of the domain's fixed values",
  CHECK_TABLE: "Value does not exist in the source system's check table",
};
const DDIC_ID = /^DDIC-(.+)-(TYPE|LENGTH|CASE|FIXED_VALUE|CHECK_TABLE)$/;

/** "DDIC-MARA-TYPE" -> "Value does not match the field's SAP data type (MARA)"; null for any other id. */
export function ddicRuleName(checkId: string | null | undefined): string | null {
  const m = checkId ? DDIC_ID.exec(checkId) : null;
  return m ? `${DDIC_KINDS[m[2]]} (${m[1]})` : null;
}

/**
 * A rule's name by check id: the tenant's rule catalogue (one shared, cached request, the one `RuleCell` reads), and
 * the DDIC conformance checks the catalogue does not hold. Undefined while loading or for an unknown id.
 */
export function useRuleNames(enabled = true): (checkId: string) => string | undefined {
  const rules = useQuery({
    queryKey: queryKeys.rules({ limit: 1000, purpose: "names" }),
    queryFn: () => getRules({ limit: 1000 }),
    staleTime: 10 * 60_000,
    enabled,
    meta: { ignoreError: true },
  });
  return useCallback(
    (checkId: string) => ddicRuleName(checkId) ?? rules.data?.rules.find((r) => r.id === checkId)?.name ?? undefined,
    [rules.data],
  );
}

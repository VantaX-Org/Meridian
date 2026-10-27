"use client";

import { useCallback, useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { getRuleNames } from "@/lib/api/rules";
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

/** "MM045: Material type missing" -> "Material type missing" for check id MM045; any other name is only trimmed. */
export function plainRuleName(checkId: string, name: string | null | undefined): string | null {
  if (!name) return null;
  const prefix = `${checkId}:`;
  const plain = name.startsWith(prefix) ? name.slice(prefix.length).trim() : name.trim();
  return plain || null;
}

/**
 * The words a findings ranking gives a rule (insights `rules` rows: the YAML message, else the check id itself);
 * undefined when the row is missing or only repeats the id.
 */
export function rankedName(
  rows: readonly { check_id: string; name?: string | null }[] | undefined,
  checkId: string,
): string | undefined {
  return ruleWords(checkId, rows?.find((r) => r.check_id === checkId)?.name);
}

/** A name a row already carries for a rule, as plain words; undefined when it is empty or only repeats the id. */
export function ruleWords(checkId: string, name: string | null | undefined): string | undefined {
  const plain = plainRuleName(checkId, name);
  return plain && plain !== checkId ? plain : undefined;
}

/**
 * THE one precedence for a rule's words, used by every surface (RuleCell, RuleName, useRuleWords, useRuleNames):
 *  1. the tenant's rule catalogue name (GET /rules/names `names`);
 *  2. the finding's own message (what the row on screen carries);
 *  3. generated words: the check engine's own words for a generated check (GET /rules/names `generated`), or a DDIC
 *     conformance check's words (`ddicRuleName`).
 * Each step is taken only when it says more than the id. Undefined when nothing names the rule (the id alone shows).
 */
export function resolveRuleName(
  checkId: string,
  { catalogue, message, generated }: { catalogue?: string | null; message?: string | null; generated?: string | null },
): string | undefined {
  return ruleWords(checkId, catalogue) ?? ruleWords(checkId, message) ?? ruleWords(checkId, generated)
    ?? ddicRuleName(checkId) ?? undefined;
}

/** One check id's names as GET /rules/names gives them: the catalogue's and the generated words. */
export interface RuleNameSources {
  name: string | null;
  generated: string | null;
}

type Waiter ={ resolve: (names: RuleNameSources) => void; reject: (e: unknown) => void };
const BATCH = 200;
let queue = new Map<string, Waiter[]>();
let scheduled = false;

async function flush(): Promise<void> {
  scheduled = false;
  const waiting = queue;
  queue = new Map();
  const ids = [...waiting.keys()];
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    try {
      const { names, generated } = await getRuleNames(chunk);
      for (const id of chunk) {
        const found = { name: plainRuleName(id, names[id]), generated: plainRuleName(id, generated[id]) };
        for (const w of waiting.get(id) ?? []) w.resolve(found);
      }
    } catch (e) {
      for (const id of chunk) for (const w of waiting.get(id) ?? []) w.reject(e);
    }
  }
}

/**
 * One check id's catalogue and generated names. Ids asked for in the same tick go out as one request (every RuleCell
 * on a page asks for its own id; the page sends one GET /rules/names), and React Query caches each id on its own.
 */
export function loadRuleName(checkId: string): Promise<RuleNameSources> {
  return new Promise((resolve, reject) => {
    const waiting = queue.get(checkId);
    if (waiting) waiting.push({ resolve, reject });
    else queue.set(checkId, [{ resolve, reject }]);
    if (!scheduled) {
      scheduled = true;
      setTimeout(() => void flush(), 0);
    }
  });
}

/** A rule-name lookup: a check id's words by `resolveRuleName`, given the message the row carries (if any). */
export type RuleNameOf = (checkId: string, message?: string | null) => string | undefined;

/**
 * Rule names for the check ids a page shows, by `resolveRuleName`: the tenant's catalogue name and the generated words
 * from GET /rules/names (batched, cached per id; DDIC conformance ids are named locally and never asked), and the
 * message the caller passes for the row. The lookup returns undefined while loading or when nothing names the id;
 * callers then show the id alone.
 */
export function useRuleNames(
  checkIds: readonly (string | null | undefined)[],
  enabled = true,
): RuleNameOf {
  const key = [...new Set(checkIds.filter((id): id is string => !!id && !ddicRuleName(id)))].sort().join("\n");
  const ids = useMemo(() => (key ? key.split("\n") : []), [key]);
  const found = useQueries({
    queries: ids.map((id) => ({
      queryKey: queryKeys.ruleName(id),
      queryFn: () => loadRuleName(id),
      staleTime: 10 * 60_000,
      enabled,
      meta: { ignoreError: true },
    })),
    // one string per result set, so the lookup below changes only when a name arrives
    combine: (results) => JSON.stringify(results.map((r) => r.data ?? null)),
  });
  const byId = useMemo(() => {
    const names = JSON.parse(found) as (RuleNameSources | null)[];
    return new Map(ids.map((id, i) => [id, names[i]]));
  }, [found, ids]);
  return useCallback<RuleNameOf>((checkId, message) => {
    const sources = byId.get(checkId);
    return resolveRuleName(checkId, { catalogue: sources?.name, message, generated: sources?.generated });
  }, [byId]);
}

/** One rule's words by `resolveRuleName`: its catalogue name, else `message` (the row's own), else generated words. */
export function useRuleWords(id: string, message?: string | null): string | undefined {
  return useRuleNames([id])(id, message);
}

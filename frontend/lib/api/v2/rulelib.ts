/**
 * The rules library (/rules): every rule of the tenant across objects, the drafts, suppressions and the verbs on
 * them. All existing endpoints: GET /rules, GET /rules/coverage/{module}, PATCH /rules/{id}, GET and DELETE
 * /rule-suppressions, POST /rule-suppressions (object.ts suppressRule), and /rule-authoring/*. In fixture mode the
 * answers come from fixtures/sys6b.ts.
 */
import { v2Get, v2Send } from "./client";
import type { Rule, ModuleCoverage, RuleSuppression } from "@/lib/api/rules";
import type { GeneratedRule, PublishedDraftRule, RuleAuthoringBody, RuleDraftDryRun, SavedDraft, RuleGenerateBody } from "@/lib/api/rule-authoring";
import type { RuleDraft } from "./object";

export type { Rule, ModuleCoverage, RuleSuppression, GeneratedRule, PublishedDraftRule, RuleAuthoringBody, RuleDraftDryRun, SavedDraft, RuleDraft };

export interface RuleList {
  rules: Rule[];
  total: number;
}

/** GET /rules, page by page (the API answers at most 1000 per call) until every rule of the tenant is read. */
export async function getRuleList(): Promise<RuleList> {
  const first = await v2Get<RuleList>("/rules", { limit: 1000, offset: 0 });
  const rules = [...first.rules];
  while (rules.length < first.total) {
    const next = await v2Get<RuleList>("/rules", { limit: 1000, offset: rules.length });
    if (!next.rules.length) break;
    rules.push(...next.rules);
  }
  return { rules, total: first.total };
}

/** GET /rules/coverage/{module}: the rules of one object with their check class and dimension. */
export const getModuleRules = (module: string): Promise<ModuleCoverage> => v2Get<ModuleCoverage>(`/rules/coverage/${encodeURIComponent(module)}`);

/** PATCH /rules/{id}: enable or disable a rule for this tenant. Needs manage_rules. */
export const setRuleEnabled = (id: string, enabled: boolean): Promise<Rule> => v2Send<Rule>("PATCH", `/rules/${encodeURIComponent(id)}`, { enabled });

export const getSuppressions = (): Promise<{ suppressions: RuleSuppression[] }> => v2Get("/rule-suppressions", { include_expired: false });
export const endSuppression = (id: string): Promise<void> => v2Send<void>("DELETE", `/rule-suppressions/${encodeURIComponent(id)}`);

/** GET /rule-authoring/drafts without a module: every draft of the tenant. Needs manage_rules. */
export async function getAllDrafts(): Promise<RuleDraft[]> {
  const res = await v2Get<{ items: RuleDraft[] }>("/rule-authoring/drafts");
  return res.items;
}
export const generateDraft = (body: RuleGenerateBody): Promise<GeneratedRule> => v2Send("POST", "/rule-authoring/generate", body);
export const dryRunDraftBody = (body: RuleAuthoringBody): Promise<RuleDraftDryRun> => v2Send("POST", "/rule-authoring/dry-run", body);
export const createDraft = (body: RuleAuthoringBody): Promise<SavedDraft> => v2Send("POST", "/rule-authoring/drafts", body);
export const updateDraft = (id: string, body: RuleAuthoringBody): Promise<SavedDraft> => v2Send("PUT", `/rule-authoring/drafts/${encodeURIComponent(id)}`, body);
export const deleteDraft = (id: string): Promise<void> => v2Send<void>("DELETE", `/rule-authoring/drafts/${encodeURIComponent(id)}`);
export const publishDraftById = (id: string): Promise<PublishedDraftRule> => v2Send("POST", `/rule-authoring/drafts/${encodeURIComponent(id)}/publish`);

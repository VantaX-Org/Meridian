/** The audit log read as sentences, for the Admin canvases and the audit inspector. Same wording as the current interface. */

import type { AuditEntry } from "@/lib/api/audit";

import { t, lc } from "@/lib/v2/i18n";
import { labelText } from "@/lib/v2/labels";

const VERB: Record<string, string> = { POST: "created", PUT: "changed", PATCH: "changed", DELETE: "removed", GET: "read" };
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const nameOf = (v: unknown): string | undefined => {
  const r = rec(v);
  const n = r.name ?? r.email ?? r.label ?? r.title;
  return typeof n === "string" ? n : undefined;
};

/** The API keys tab's actions (api/routes/api_keys.py): the key's name is in the audit row, never the key. */
const API_KEY_VERB: Record<string, string> = { "api_key.create": "created", "api_key.revoke": "revoked", "api_key.delete": "deleted" };

/** What each audited route is about, in the words a person uses. The key is the first path segment after /api/v1. */
const ENTITY: Record<string, { noun: string; plural?: string; mass?: boolean }> = {
  versions: { noun: "run" },
  runs: { noun: "run" },
  upload: { get noun() { return t("file upload"); } },
  users: { noun: "user" },
  roles: { noun: "role" },
  report: { noun: "report" },
  reports: { noun: "report" },
  settings: { noun: "setting" },
  systems: { noun: "system" },
  connectivity: { get noun() { return t("system connection"); } },
  rules: { noun: "rule" },
  exceptions: { noun: "exception" },
  stewardship: { get noun() { return t("inbox task"); } },
  cleaning: { get noun() { return t("cleaning item"); } },
  findings: { noun: "finding" },
  jobs: { noun: "job" },
  notifications: { noun: "notification" },
  mining: { get noun() { return t("process mining"); }, mass: true },
  glossary: { get noun() { return t("glossary term"); } },
  contracts: { get noun() { return t("data contract"); } },
  issues: { get noun() { return t("record issue"); } },
  work: { get noun() { return t("fix work item"); } },
  triage: { get noun() { return t("triage item"); } },
  simulations: { get noun() { return t("what-if simulation"); } },
  assistant: { get noun() { return t("assistant question"); } },
  me: { noun: "profile" },
};

/** The verb of an action as it reads in the past tense. The action is the path's last word ("analyse", "retry"). */
const PAST: Record<string, string> = {
  create: "created", update: "changed", delete: "removed", analyse: "analysed", analyze: "analysed", export: "exported",
  run: "ran", retry: "retried", test: "tested", invite: "invited", approve: "approved", reject: "rejected",
  assign: "assigned", resolve: "resolved", escalate: "escalated", register: "registered", revoke: "revoked",
  sync: "synced", restore: "restored", archive: "archived", publish: "published", import: "imported",
  upload: "uploaded", cancel: "cancelled", acknowledge: "acknowledged", read: "read",
};

/** A few actions read better as a whole than as verb plus noun. */
const SPECIAL: Record<string, { past: string; noun: string; plural?: string; phrase?: string }> = {
  "versions:create": { past: "started", noun: "run" },
  "runs:create": { past: "started", noun: "run" },
  "versions:analyse": { past: "started", noun: "analysis", plural: "analyses" },
  "upload:create": { past: "uploaded", noun: "file" },
  "me:create": { past: "changed", noun: "profile", get phrase() { return t("their profile"); } },
  "me:update": { past: "changed", noun: "profile", get phrase() { return t("their profile"); } },
};

const singular = (word: string) => (word.endsWith("ies") ? `${word.slice(0, -3)}y` : word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word);
const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const article = (noun: string) => (/^(?!use|uni|ur[ei])[aeiou]/i.test(noun) ? "an" : "a");

/** The last word of an action ("report.export" -> "export"; "api_key.create" -> "create"). */
const verbOf = (action: string) => action.split(".").pop() ?? action;

/** The kind of change an entry records, in plain words: its past-tense verb, what it was done to, and a tile label. */
export function auditKind(r: { action: string; entity_type: string | null }): { past: string; noun: string; phrase?: string; label: string } {
  const verb = verbOf(r.action);
  const entity = r.entity_type ?? "";
  const special = SPECIAL[`${entity}:${verb}`];
  const known = ENTITY[entity];
  const noun = special?.noun ?? known?.noun ?? (entity ? lc(labelText(singular(entity))) : "record");
  const past = special?.past ?? PAST[verb] ?? "changed";
  const plural = special?.plural ?? known?.plural ?? (known?.mass ? undefined : `${noun}s`);
  const label = special?.phrase ? t("{cap} changes", { cap: cap(noun) }) : plural ? `${cap(plural)} ${past}` : `${cap(noun)} ${past}`;
  return { past, noun, phrase: special?.phrase ?? (known?.mass && !special ? noun : undefined), label };
}

/** What an entry's tile or filter chip says: "Users created", "Runs started", "Reports exported". */
export const auditKindLabel = (r: { action: string; entity_type: string | null }): string => auditKind(r).label;

/** The person behind an entry: the name part of their email, else the system. */
export const auditActor = (e: Pick<AuditEntry, "actor_email">): string => (e.actor_email ? e.actor_email.split("@")[0] : t("The system"));

/** What an entry was done to: the name in its payload, else the kind of thing ("Run", "User"). */
export function auditTarget(e: AuditEntry): string {
  return nameOf(e.after_json) ?? nameOf(e.before_json) ?? cap(auditKind(e).noun);
}

/** One sentence per action: "ana changed the role of Bob from steward to admin", built from method, path and entity. */
export function auditSentence(e: AuditEntry): string {
  const who = auditActor(e);
  const before = rec(e.before_json), after = rec(e.after_json);
  const kind = auditKind(e);
  const thing = kind.noun;
  const subject = nameOf(e.after_json) ?? nameOf(e.before_json);
  const failed = e.status_code >= 400 ? t(" (refused, {status_code})", { status_code: e.status_code }) : "";
  const keyVerb = API_KEY_VERB[e.action];
  if (keyVerb) return t("{who} {keyVerb} the API key {subject}{failed}", { who, keyVerb, subject: subject ?? t("(unnamed)"), failed });
  if ("role" in before && "role" in after && before.role !== after.role) {
    return t("{who} changed the role of {subject} from {role} to {role2}{failed}", { who, subject: subject ?? `a ${thing}`, role: lc(labelText(String(before.role))), role2: labelText(String(after.role)).toLowerCase(), failed });
  }
  const verb = e.entity_type || PAST[verbOf(e.action)] ? kind.past : VERB[e.method.toUpperCase()] ?? lc(labelText(e.action));
  const what = kind.phrase ?? (subject ? t("the {thing} {subject}", { thing, subject }) : `${article(thing)} ${thing}`);
  return `${who} ${verb} ${what}${failed}`;
}


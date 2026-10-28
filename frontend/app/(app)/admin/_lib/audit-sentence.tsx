/** The audit log's two readings of an entry, shared by Admin › Audit log and Admin › Roles › History. */

import type { AuditEntry } from "@/lib/api/audit";
import { formatDate, labelOf, relativeTime } from "@/lib/format";

const VERB: Record<string, string> = { POST: "created", PUT: "changed", PATCH: "changed", DELETE: "removed", GET: "read" };
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const nameOf = (v: unknown): string | undefined => {
  const r = rec(v);
  const n = r.name ?? r.email ?? r.label ?? r.title;
  return typeof n === "string" ? n : undefined;
};

/** The API keys tab's actions (api/routes/api_keys.py): the key's name is in the audit row, never the key. */
const API_KEY_VERB: Record<string, string> = { "api_key.create": "created", "api_key.revoke": "revoked", "api_key.delete": "deleted" };

/** One sentence per action: "ana changed the role of Bob from steward to admin", built from method, path and entity. */
export function auditSentence(e: AuditEntry): string {
  const who = e.actor_email ? e.actor_email.split("@")[0] : "The system";
  const before = rec(e.before_json), after = rec(e.after_json);
  const thing = (e.entity_type ? labelOf(e.entity_type).toLowerCase() : e.path.split("/").filter((p) => p && !/^(api|v1)$/.test(p) && !/^[0-9a-f-]{8,}$/i.test(p)).slice(-1)[0]?.replace(/[-_]/g, " ")) || "record";
  const subject = nameOf(e.after_json) ?? nameOf(e.before_json);
  const failed = e.status_code >= 400 ? ` (refused, ${e.status_code})` : "";
  const keyVerb = API_KEY_VERB[e.action];
  if (keyVerb) return `${who} ${keyVerb} the API key ${subject ?? "(unnamed)"}${failed}`;
  if ("role" in before && "role" in after && before.role !== after.role) {
    return `${who} changed the role of ${subject ?? `a ${thing}`} from ${labelOf(String(before.role)).toLowerCase()} to ${labelOf(String(after.role)).toLowerCase()}${failed}`;
  }
  const verb = VERB[e.method.toUpperCase()] ?? labelOf(e.action).toLowerCase();
  return `${who} ${verb} ${subject ? `the ${thing} ${subject}` : `a ${thing}`}${failed}`;
}

/** The absolute time in the tenant zone, labelled with it ("2 Oct 2026, 07:09 GMT+2"); the relative time as its tooltip. */
export function When({ iso, tz }: { iso: string; tz: string }) {
  return <time dateTime={iso} title={relativeTime(iso)}>{formatDate(iso, "datetime", tz)}</time>;
}

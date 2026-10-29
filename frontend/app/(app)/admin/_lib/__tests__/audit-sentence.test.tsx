import { describe, expect, it } from "vitest";
import type { AuditEntry } from "@/lib/api/audit";
import { auditKindLabel, auditSentence } from "../audit-sentence";

const entry = (action: string, over: Partial<AuditEntry> = {}): AuditEntry => ({
  id: "a1", actor_user_id: "u1", actor_email: "ana@example.test", action, entity_type: "api_key", entity_id: "k1",
  method: "POST", path: "/api/v1/admin/api-keys", status_code: 200, ip: null, user_agent: null,
  before_json: null, after_json: { name: "Nightly extraction", key_prefix: "abc123def456" }, created_at: "2026-10-01T08:00:00Z", ...over,
});

describe("auditSentence in plain words", () => {
  const e = (action: string, entity_type: string | null, method = "POST") =>
    entry(action, { entity_type, method, path: "/api/v1/x", before_json: null, after_json: null });
  it("never prints a route name as a noun", () => {
    expect(auditSentence(e("create", "versions"))).toBe("ana started a run");
    expect(auditSentence(e("create", "upload"))).toBe("ana uploaded a file");
    expect(auditSentence(e("create", "me"))).toBe("ana changed their profile");
    expect(auditSentence(e("update", "me", "PUT"))).toBe("ana changed their profile");
    expect(auditSentence(e("report.export", "report"))).toBe("ana exported a report");
  });
  it("labels the summary tiles", () => {
    expect(auditKindLabel({ action: "analyse", entity_type: "versions" })).toBe("Analyses started");
    expect(auditKindLabel({ action: "report.export", entity_type: "report" })).toBe("Reports exported");
    expect(auditKindLabel({ action: "run", entity_type: "mining" })).toBe("Process mining ran");
  });
});

describe("auditSentence for API keys", () => {
  it("reads create, revoke and delete as plain sentences naming the key", () => {
    expect(auditSentence(entry("api_key.create"))).toBe("ana created the API key Nightly extraction");
    expect(auditSentence(entry("api_key.revoke", { before_json: { name: "Nightly extraction" } }))).toBe("ana revoked the API key Nightly extraction");
    expect(auditSentence(entry("api_key.delete", { method: "DELETE", before_json: { name: "Nightly extraction" }, after_json: null }))).toBe("ana deleted the API key Nightly extraction");
  });
  it("never prints a key prefix or secret", () => {
    expect(auditSentence(entry("api_key.create"))).not.toMatch(/abc123|mk_/);
  });
});

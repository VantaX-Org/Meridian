import { describe, expect, it } from "vitest";
import type { AuditEntry } from "@/lib/api/audit";
import { auditActor, auditKind, auditKindLabel, auditSentence, auditTarget } from "./audit-sentence";

const entry = (over: Partial<AuditEntry>): AuditEntry => ({
  id: 1, actor_user_id: 1, actor_email: "ana@example.com", action: "users.create", entity_type: "users", entity_id: "7",
  method: "POST", path: "/api/v1/users", status_code: 201, ip: null, user_agent: null, before_json: null, after_json: null,
  created_at: "2026-11-17T08:00:00Z", ...over,
} as AuditEntry);

describe("auditKind", () => {
  it("reads special actions as a whole", () => {
    expect(auditKind({ action: "versions.create", entity_type: "versions" })).toMatchObject({ past: "started", noun: "run", label: "Runs started" });
    expect(auditKind({ action: "versions.analyse", entity_type: "versions" }).label).toBe("Analyses started");
    expect(auditKind({ action: "me.update", entity_type: "me" }).phrase).toBe("their profile");
    expect(auditKindLabel({ action: "me.update", entity_type: "me" })).toBe("Profile changes");
  });

  it("names known, mass, unknown and missing entities", () => {
    expect(auditKindLabel({ action: "report.export", entity_type: "reports" })).toBe("Reports exported");
    const mining = auditKind({ action: "mining.run", entity_type: "mining" });
    expect(mining.phrase).toBe(mining.noun);
    expect(mining.label).toMatch(/ ran$/);
    expect(auditKind({ action: "widgets.frobnicate", entity_type: "widgets" })).toMatchObject({ past: "changed", noun: "widget" });
    expect(auditKind({ action: "categories.delete", entity_type: "categories" }).noun).toBe("category");
    expect(auditKind({ action: "x", entity_type: null }).noun).toBe("record");
  });
});

describe("auditActor and auditTarget", () => {
  it("uses the email's name part, else the system", () => {
    expect(auditActor({ actor_email: "ana@example.com" })).toBe("ana");
    expect(auditActor({ actor_email: null })).toBe("The system");
  });

  it("prefers the payload's name, then the kind of thing", () => {
    expect(auditTarget(entry({ after_json: { name: "Bob" } }))).toBe("Bob");
    expect(auditTarget(entry({ before_json: { email: "b@x.io" } }))).toBe("b@x.io");
    expect(auditTarget(entry({ after_json: ["not", "a", "record"] }))).toBe("User");
  });
});

describe("auditSentence", () => {
  it("never says a refused request happened", () => {
    expect(auditSentence(entry({ status_code: 403 }))).toBe("ana was refused (403): users.create");
    expect(auditSentence(entry({ status_code: 422, after_json: { name: "Bob" } }))).toBe("ana was refused (422): users.create on Bob");
  });

  it("names API keys, never their secret", () => {
    expect(auditSentence(entry({ action: "api_key.revoke", entity_type: "api_key", after_json: { name: "ci" } }))).toBe("ana revoked the API key ci");
    expect(auditSentence(entry({ action: "api_key.create", entity_type: "api_key" }))).toBe("ana created the API key (unnamed)");
  });

  it("reads a role change", () => {
    const s = auditSentence(entry({ action: "users.update", before_json: { role: "steward", name: "Bob" }, after_json: { role: "admin", name: "Bob" } }), "Ana");
    expect(s).toMatch(/^Ana changed the role of Bob from .* to .*$/);
  });

  it("builds verb plus thing from entity, method or action", () => {
    expect(auditSentence(entry({ after_json: { name: "Bob" } }))).toBe("ana created the user Bob");
    expect(auditSentence(entry({ action: "rules.update", entity_type: "rules" }))).toBe("ana changed a rule");
    expect(auditSentence(entry({ action: "exceptions.create", entity_type: "exceptions" }))).toBe("ana created an exception");
    expect(auditSentence(entry({ action: "me.update", entity_type: "me" }))).toBe("ana changed their profile");
    expect(auditSentence(entry({ action: "poke", entity_type: null, method: "DELETE" }))).toBe("ana removed a record");
    expect(auditSentence(entry({ action: "poke", entity_type: null, method: "OPTIONS" }))).toMatch(/^ana \S+ a record$/);
  });
});

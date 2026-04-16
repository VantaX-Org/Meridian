import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import worker from "./index";

const ADMIN_SECRET = "test-admin-secret";

async function callWorker(
  path: string,
  options: RequestInit & { method?: string } = {}
): Promise<Response> {
  const request = new Request(`http://localhost${path}`, options);
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    request,
    { ...env, LICENCE_ADMIN_SECRET: ADMIN_SECRET } as never,
    ctx
  );
  await waitOnExecutionContext(ctx);
  return response;
}

function adminHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Admin-Secret": ADMIN_SECRET,
    ...extra,
  };
}

async function createTestTenant(
  overrides: Record<string, unknown> = {}
): Promise<{ id: string; licence_key: string }> {
  const body = {
    company_name: "Test Corp",
    contact_email: "test@example.com",
    tier: "professional",
    expiry_date: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    ...overrides,
  };
  const resp = await callWorker("/api/admin/tenants", {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify(body),
  });
  expect(resp.status).toBe(201);
  return resp.json() as Promise<{ id: string; licence_key: string }>;
}

// ─── Licence Validation ───────────────────────────────────────────────────────

describe("POST /api/licence/validate", () => {
  it("returns valid manifest for a valid licence key", async () => {
    const { licence_key } = await createTestTenant();

    const resp = await callWorker("/api/licence/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ licenceKey: licence_key, machineFingerprint: "abc123" }),
    });

    expect(resp.status).toBe(200);
    const data = (await resp.json()) as {
      valid: boolean;
      enabled_modules: string[];
      enabled_menu_items: string[];
      features: Record<string, unknown>;
      rules: unknown[];
      field_mappings: unknown[];
      llm_config: Record<string, unknown>;
    };
    expect(data.valid).toBe(true);
    expect(Array.isArray(data.enabled_modules)).toBe(true);
    expect(data.enabled_modules.length).toBeGreaterThan(0);
    expect(Array.isArray(data.enabled_menu_items)).toBe(true);
    expect(typeof data.features).toBe("object");
    expect(Array.isArray(data.rules)).toBe(true);
    expect(Array.isArray(data.field_mappings)).toBe(true);
    expect(typeof data.llm_config).toBe("object");
  });

  it("returns 403 for an invalid key", async () => {
    const resp = await callWorker("/api/licence/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ licenceKey: "MRDX-FAKE-FAKE-FAKE", machineFingerprint: "abc" }),
    });

    expect(resp.status).toBe(403);
    const data = (await resp.json()) as { valid: boolean; reason: string };
    expect(data.valid).toBe(false);
    expect(data.reason).toBe("invalid_key");
  });

  it("returns 403 with reason:expired for an expired key", async () => {
    const { licence_key } = await createTestTenant({
      expiry_date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      status: "active",
    });

    const resp = await callWorker("/api/licence/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ licenceKey: licence_key, machineFingerprint: "abc" }),
    });

    expect(resp.status).toBe(403);
    const data = (await resp.json()) as { valid: boolean; reason: string };
    expect(data.valid).toBe(false);
    expect(data.reason).toBe("expired");
  });

  it("returns 403 with reason:suspended for a suspended key", async () => {
    const { licence_key } = await createTestTenant({ status: "suspended" });

    const resp = await callWorker("/api/licence/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ licenceKey: licence_key, machineFingerprint: "abc" }),
    });

    expect(resp.status).toBe(403);
    const data = (await resp.json()) as { valid: boolean; reason: string };
    expect(data.valid).toBe(false);
    expect(data.reason).toBe("suspended");
  });

  it("returns 400 if licenceKey is missing", async () => {
    const resp = await callWorker("/api/licence/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ machineFingerprint: "abc" }),
    });
    expect(resp.status).toBe(400);
  });
});

// ─── Heartbeat ────────────────────────────────────────────────────────────────

describe("GET /api/licence/heartbeat", () => {
  it("returns status:ok", async () => {
    const resp = await callWorker("/api/licence/heartbeat");
    expect(resp.status).toBe(200);
    const data = (await resp.json()) as { status: string };
    expect(data.status).toBe("ok");
  });
});

// ─── Admin: Tenants ───────────────────────────────────────────────────────────

describe("Admin Tenant CRUD", () => {
  it("returns 401 without admin secret", async () => {
    const resp = await callWorker("/api/admin/tenants");
    expect(resp.status).toBe(401);
  });

  it("creates and retrieves a tenant", async () => {
    const { id, licence_key } = await createTestTenant();
    expect(id).toBeTruthy();
    expect(licence_key).toMatch(/^MRDX-[A-F0-9]+-[A-F0-9]+-[A-F0-9]+$/);

    const getResp = await callWorker(`/api/admin/tenants/${id}`, {
      headers: adminHeaders(),
    });
    expect(getResp.status).toBe(200);
    const tenant = (await getResp.json()) as { id: string; company_name: string };
    expect(tenant.id).toBe(id);
    expect(tenant.company_name).toBe("Test Corp");
  });

  it("lists tenants", async () => {
    await createTestTenant({ company_name: "Acme Ltd" });
    const resp = await callWorker("/api/admin/tenants", { headers: adminHeaders() });
    expect(resp.status).toBe(200);
    const data = (await resp.json()) as { tenants: unknown[] };
    expect(Array.isArray(data.tenants)).toBe(true);
    expect(data.tenants.length).toBeGreaterThan(0);
  });

  it("patches tenant status", async () => {
    const { id } = await createTestTenant();
    const resp = await callWorker(`/api/admin/tenants/${id}`, {
      method: "PATCH",
      headers: adminHeaders(),
      body: JSON.stringify({ status: "active" }),
    });
    expect(resp.status).toBe(200);
    const tenant = (await resp.json()) as { status: string };
    expect(tenant.status).toBe("active");
  });

  it("regenerates licence key", async () => {
    const { id, licence_key: originalKey } = await createTestTenant();
    const resp = await callWorker(`/api/admin/tenants/${id}/regenerate-key`, {
      method: "POST",
      headers: adminHeaders(),
    });
    expect(resp.status).toBe(200);
    const data = (await resp.json()) as { licence_key: string };
    expect(data.licence_key).not.toBe(originalKey);
    expect(data.licence_key).toMatch(/^MRDX-/);
  });
});

// ─── Admin: Rules ─────────────────────────────────────────────────────────────

describe("Admin Rules CRUD", () => {
  it("creates and lists rules", async () => {
    const createResp = await callWorker("/api/admin/rules", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        name: "BP Type is Required",
        module: "business_partner",
        category: "ecc",
        severity: "critical",
        conditions: [{ field: "BU_TYPE", operator: "is_not_null", value: "" }],
      }),
    });
    expect(createResp.status).toBe(201);
    const rule = (await createResp.json()) as { id: string; enabled: boolean };
    expect(rule.enabled).toBe(true);

    const listResp = await callWorker("/api/admin/rules?module=business_partner", {
      headers: adminHeaders(),
    });
    expect(listResp.status).toBe(200);
    const list = (await listResp.json()) as { rules: unknown[] };
    expect(list.rules.length).toBeGreaterThan(0);
  });

  it("toggles rule enabled state via PATCH", async () => {
    const createResp = await callWorker("/api/admin/rules", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        name: "Toggle Test Rule",
        module: "fi_gl",
        category: "ecc",
        severity: "medium",
      }),
    });
    const { id } = (await createResp.json()) as { id: string };

    const patchResp = await callWorker(`/api/admin/rules/${id}`, {
      method: "PATCH",
      headers: adminHeaders(),
      body: JSON.stringify({ enabled: false }),
    });
    expect(patchResp.status).toBe(200);
    const updated = (await patchResp.json()) as { enabled: boolean };
    expect(updated.enabled).toBe(false);
  });

  it("deletes a rule", async () => {
    const createResp = await callWorker("/api/admin/rules", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ name: "Delete Me", module: "fi_gl", category: "ecc" }),
    });
    const { id } = (await createResp.json()) as { id: string };

    const delResp = await callWorker(`/api/admin/rules/${id}`, {
      method: "DELETE",
      headers: adminHeaders(),
    });
    expect(delResp.status).toBe(200);
    const data = (await delResp.json()) as { deleted: boolean };
    expect(data.deleted).toBe(true);

    const getResp = await callWorker(`/api/admin/rules/${id}`, { headers: adminHeaders() });
    expect(getResp.status).toBe(404);
  });

  it("bulk imports rules", async () => {
    const resp = await callWorker("/api/admin/rules/import", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        rules: [
          { name: "Rule A", module: "mm_purchasing", category: "ecc", severity: "high" },
          { name: "Rule B", module: "mm_purchasing", category: "ecc", severity: "medium" },
        ],
      }),
    });
    expect(resp.status).toBe(200);
    const data = (await resp.json()) as { imported: number };
    expect(data.imported).toBe(2);
  });
});

// ─── Admin: Analytics ────────────────────────────────────────────────────────

describe("GET /api/admin/analytics", () => {
  it("returns tenant statistics", async () => {
    await createTestTenant({ company_name: "Analytics Test", status: "active" });
    const resp = await callWorker("/api/admin/analytics", { headers: adminHeaders() });
    expect(resp.status).toBe(200);
    const data = (await resp.json()) as {
      total: number;
      by_status: Record<string, number>;
      by_tier: Record<string, number>;
      expiring_soon: unknown[];
      recent_activity: unknown[];
    };
    expect(data.total).toBeGreaterThan(0);
    expect(typeof data.by_status).toBe("object");
    expect(typeof data.by_tier).toBe("object");
    expect(Array.isArray(data.expiring_soon)).toBe(true);
  });
});

// ─── Manifest includes rules ──────────────────────────────────────────────────

describe("Licence manifest includes rules from D1", () => {
  it("returns matching rules for enabled modules", async () => {
    // Create a rule for business_partner
    await callWorker("/api/admin/rules", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        name: "BP Partner Number",
        module: "business_partner",
        category: "ecc",
        severity: "critical",
      }),
    });

    // Create tenant with business_partner module
    const { licence_key } = await createTestTenant({
      enabled_modules: ["business_partner"],
    });

    // Validate — should return rules
    const resp = await callWorker("/api/licence/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ licenceKey: licence_key, machineFingerprint: "test" }),
    });
    expect(resp.status).toBe(200);
    const data = (await resp.json()) as { rules: Array<{ module: string }> };
    expect(data.rules.length).toBeGreaterThan(0);
    expect(data.rules.every((r) => r.module === "business_partner")).toBe(true);
  });
});

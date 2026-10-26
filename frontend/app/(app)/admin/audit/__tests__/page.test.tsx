import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as auditApi from "@/lib/api/audit";
import * as usersApi from "@/lib/api/users";
import * as triageApi from "@/lib/api/triage";
import type { AuditEntry } from "@/lib/api/audit";
import AdminAuditPage from "../page";

let tab = "log";
vi.mock("@/hooks/use-url-state", () => ({ useUrlState: () => [tab, vi.fn()] }));
vi.mock("@/lib/permissions", () => ({ usePermissions: () => ({ has: () => true, loading: false }), usePermissionsContext: () => null }));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true, loading: false }) }));

const ENTRY: AuditEntry = {
  id: "a1", actor_user_id: "u1", actor_email: "ana@x.io", action: "user.update", entity_type: "user",
  entity_id: "0b8f7c2e-1111-2222-3333-444455556666", method: "PUT", path: "/api/v1/users/0b8f7c2e-1111-2222-3333-444455556666",
  status_code: 200, ip: null, user_agent: null, before_json: { name: "Bob", role: "viewer" }, after_json: { name: "Bob", role: "admin" },
  created_at: "2026-01-02T22:00:00Z",
};

beforeEach(() => {
  tab = "log";
  vi.restoreAllMocks();
  vi.spyOn(triageApi, "getTriageSettings").mockResolvedValue({
    timezone: "Africa/Johannesburg", work_days: [1, 2, 3, 4, 5], work_start: "08:00", work_end: "17:00", holidays: [], fallback_user_id: null,
  });
  vi.spyOn(auditApi, "getAuditSummary").mockResolvedValue({ summary: [] });
  vi.spyOn(usersApi, "getUsers").mockResolvedValue({ users: [{ id: "u1", tenant_id: "t", clerk_user_id: null, email: "ana@x.io", name: "Ana", role: "admin", permissions: null, is_active: true, last_login: null, created_at: "2026-01-01T00:00:00Z" }] });
});

describe("admin audit page", () => {
  it("shows the absolute time in the tenant zone and keeps the request out of the columns", async () => {
    vi.spyOn(auditApi, "getAuditEntries").mockResolvedValue({ entries: [ENTRY], total: 1, limit: 100, offset: 0 });
    renderWithQuery(<AdminAuditPage />);
    expect(await screen.findByText("3 Jan 2026, 00:00 GMT+2")).toBeInTheDocument();
    expect(screen.getByText("ana changed the role of Bob from viewer to admin")).toBeInTheDocument();
    expect(screen.queryByText(/PUT \/api\/v1\/users/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expand row" }));
    expect(screen.getByText(`PUT ${ENTRY.path}`)).toBeInTheDocument();
  });

  it("pages through the log and filters by date", async () => {
    const get = vi.spyOn(auditApi, "getAuditEntries").mockResolvedValue({ entries: [ENTRY], total: 250, limit: 100, offset: 0 });
    renderWithQuery(<AdminAuditPage />);
    await screen.findByText("1–100 of 250");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(get).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 100, limit: 100 })));
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-01-01" } });
    await waitFor(() => expect(get).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0, since: expect.any(String) })));
  });

  it("summarises the last 30 days and filters the log by a picked kind", async () => {
    vi.spyOn(auditApi, "getAuditSummary").mockResolvedValue({ summary: [
      { action: "create", entity_type: "user", count: 12 },
      { action: "retry", entity_type: null, count: 3 },
    ] });
    const get = vi.spyOn(auditApi, "getAuditEntries").mockResolvedValue({ entries: [ENTRY], total: 1, limit: 100, offset: 0 });
    renderWithQuery(<AdminAuditPage />);
    expect(await screen.findByText("Changes, last 30 days")).toBeInTheDocument();
    expect(await screen.findByText("15")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: /Create user/ }));
    await waitFor(() => expect(get).toHaveBeenLastCalledWith(expect.objectContaining({ action: "create", entity_type: "user", offset: 0 })));
    fireEvent.click(screen.getByRole("button", { name: "Remove filter Kind" }));
    await waitFor(() => expect(get.mock.lastCall?.[0]?.action).toBeUndefined());
  });

  it("lists every change to users, not only edits", async () => {
    tab = "roles";
    const get = vi.spyOn(auditApi, "getAuditEntries").mockResolvedValue({ entries: [], total: 0, limit: 100, offset: 0 });
    renderWithQuery(<AdminAuditPage />);
    await screen.findByText("No user changes recorded");
    expect(get).toHaveBeenCalledWith(expect.objectContaining({ path_contains: "/users" }));
    expect(get.mock.calls.every(([p]) => p?.method === undefined)).toBe(true);
  });

  it("pages through every AI call, not only the newest 100", async () => {
    tab = "ai";
    const call = { id: "c1", service_name: "nlq", called_at: "2026-01-02T22:00:00Z", model_version: null, prompt_hash: null, token_count: 10, latency_ms: 5, success: true, deterministic_hit: false, skip_reason: null };
    const get = vi.spyOn(auditApi, "getLlmAudit").mockResolvedValue({ entries: [call], total: 230, limit: 100, offset: 0, cache: [] });
    renderWithQuery(<AdminAuditPage />);
    await screen.findByText("1–100 of 230");
    expect(get).toHaveBeenCalledWith({ limit: 100, offset: 0 });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(get).toHaveBeenLastCalledWith({ limit: 100, offset: 100 }));
  });
});

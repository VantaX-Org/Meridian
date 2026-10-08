import { screen, waitFor } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as usersApi from "@/lib/api/users";
import * as authApi from "@/lib/api/auth";
import * as auditApi from "@/lib/api/audit";
import type { User } from "@/types/api";
import AdminUsersPage from "../page";

vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));

const USER: User = {
  id: "u1", tenant_id: "t1", clerk_user_id: null, email: "ana@example.com", name: "Ana Steward",
  role: "steward", permissions: null, is_active: true, last_login: null, created_at: "2026-01-01T00:00:00Z",
};

describe("admin users page", () => {
  it("renders users, roles and audit log once loaded", async () => {
    vi.spyOn(usersApi, "getUsers").mockResolvedValue({ users: [USER] });
    vi.spyOn(usersApi, "getAssignableUsers").mockResolvedValue([]);
    vi.spyOn(authApi, "getRoleMatrix").mockResolvedValue({ steward: ["fix"] });
    vi.spyOn(auditApi, "getAuditEntries").mockResolvedValue({ entries: [], total: 0, limit: 50, offset: 0 });
    renderWithQuery(<AdminUsersPage />);
    await waitFor(() => expect(screen.getByText("Ana Steward")).toBeInTheDocument());
  });

  it("shows a retryable error when users fail to load", async () => {
    const spy = vi.spyOn(usersApi, "getUsers").mockRejectedValue(new Error("network down"));
    vi.spyOn(usersApi, "getAssignableUsers").mockResolvedValue([]);
    vi.spyOn(authApi, "getRoleMatrix").mockResolvedValue({ steward: ["fix"] });
    vi.spyOn(auditApi, "getAuditEntries").mockResolvedValue({ entries: [], total: 0, limit: 50, offset: 0 });
    renderWithQuery(<AdminUsersPage />);
    await waitFor(() => expect(screen.getByText(/network down/)).toBeInTheDocument());
    const retry = screen.getAllByRole("button", { name: /retry/i })[0];
    spy.mockResolvedValue({ users: [USER] });
    retry.click();
    await waitFor(() => expect(screen.getByText("Ana Steward")).toBeInTheDocument());
  });
});

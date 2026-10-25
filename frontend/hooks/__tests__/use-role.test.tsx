import { render, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRole } from "../use-role";

const h = vi.hoisted(() => ({ user: { role: "viewer", permissions: [] as string[] }, replace: vi.fn() }));
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: h.replace }) }));

import HomeRedirect from "@/app/(app)/home/page";

describe("useRole with persona role keys", () => {
  beforeEach(() => h.replace.mockClear());

  it.each([
    ["data_steward", "/fix", ["approve"]],
    ["data_owner", "/fix", ["approve"]],
    ["data_steward", "/home/steward", []], // a custom steward role that may neither approve nor apply
    ["programme_lead", "/home/lead", []],
    ["platform_admin", "/home/lead", []],
    ["sap_basis", "/home/basis", []],
    ["process_analyst", "/home/process", []],
  ])("keeps %s (not viewer) and lands it on %s", async (role, home, permissions) => {
    h.user = { role, permissions };
    expect(renderHook(() => useRole()).result.current.role).toBe(role);
    render(<HomeRedirect />);
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith(home));
  });

  it("treats platform_admin as admin and an unknown key as viewer", () => {
    h.user = { role: "platform_admin", permissions: ["manage_system"] };
    expect(renderHook(() => useRole()).result.current.isAdmin).toBe(true);
    h.user = { role: "superuser", permissions: [] };
    expect(renderHook(() => useRole()).result.current.role).toBe("viewer");
  });
});

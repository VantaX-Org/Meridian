import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { canAdminister } from "@/lib/v2/admin-sections";
import { AdminCanvas } from "../admin/Admin";
import { setUrl } from "./nav-store";
import { stubLayout } from "./layout-stub";

const h = vi.hoisted(() => ({ perms: [] as string[] }));

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("@/lib/v2/hooks", async (orig) => {
  const m = await orig<typeof import("@/lib/v2/hooks")>();
  return { ...m, useV2Session: () => ({ persona: "lead", label: "Viewer", name: "Test", email: null, id: "u-me", fixture: true, shared: false, viewAs: null, can: (a: string) => h.perms.includes(a) }) };
});

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const page = (section: string) => {
  setUrl(`/admin/${section}?fixture=1`);
  return renderWithQuery(<AdminCanvas section={section as never} />);
};

describe("Admin section gate", () => {
  it("asks for the permission when no need of the section is held, whatever the URL", async () => {
    h.perms = ["view"];
    page("users");
    expect(await screen.findByTestId("needs-permission")).toBeInTheDocument();
  });

  it("opens the section when one of its needs is held", async () => {
    h.perms = ["view", "manage_settings"];
    page("subjectrequests");
    expect(await screen.findByLabelText("Record key or value")).toBeInTheDocument();
    expect(screen.queryByTestId("needs-permission")).toBeNull();
  });

  it("offers Administration only to someone who can act in a visible section", () => {
    expect(canAdminister((a) => a === "view")).toBe(false);
    expect(canAdminister((a) => ["view", "manage_users"].includes(a))).toBe(true);
    expect(canAdminister((a) => ["view", "view_audit"].includes(a))).toBe(true);
  });
});

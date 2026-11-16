import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { stubLayout } from "@/design/v2/__tests__/layout-stub";
import { ToastProvider } from "../../kit";
import { SheetHost } from "../../shell/SheetHost";
import { AdminCanvas } from "../sections/Canvas";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

/* Every native admin section renders from the fixtures with a page heading, and none mounts the legacy screens. */
const SECTIONS = ["users", "roles", "sso", "signin", "apikeys", "licence", "billing", "settings", "mappings", "reference", "contactverify", "matchrules", "audit", "alerts", "notifications", "webhooks", "subjectrequests", "externaldb", "dqfirewall", "policypacks", "digests", "runs", "runschedules", "systems", "system", "aletheia", "stewardship", "configbundle", "viewas", "rulesio", "sharelinks", "delegations", "workflows", "ruleaccuracy"];

let undo: () => void = () => undefined;
const go = (u: string) => { window.history.pushState({}, "", u); setUrl(u); };
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
});
afterEach(() => {
  undo();
  window.history.pushState({}, "", "/");
  window.sessionStorage.clear();
});
const view = (s: string) => renderWithQuery(<ToastProvider><SheetHost><AdminCanvas section={s} /></SheetHost></ToastProvider>);

describe("native admin sections on fixtures", () => {
  it.each(SECTIONS)("%s renders a page heading for an administrator", async (s) => {
    go(`/more/admin/${s}?fixture=1`);
    const { container } = view(s);
    await waitFor(() => expect(screen.getAllByRole("heading", { level: 1 }).length).toBeGreaterThan(0));
    expect(container.querySelector(".m2-legacy, [data-legacy]")).toBeNull();
  });

  it.each(SECTIONS)("%s still renders, gated, for a viewer", async (s) => {
    go(`/more/admin/${s}?fixture=1&role=viewer`);
    view(s);
    await waitFor(() => expect(screen.getAllByRole("heading", { level: 1 }).length).toBeGreaterThan(0));
  });

  it("the audit log asks a viewer for the view audit permission", async () => {
    go("/more/admin/audit?fixture=1&role=viewer");
    view("audit");
    expect(await screen.findByText(/view_audit|view audit/i)).toBeInTheDocument();
  });
});

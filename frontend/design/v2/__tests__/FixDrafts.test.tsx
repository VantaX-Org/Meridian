import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { resetFixDrafts } from "@/lib/api/v2/fixtures/fixDrafts";
import { FixDrafts, coveragePct } from "../screens/FixDrafts";
import { ToastProvider } from "../Toast";
import { stubLayout } from "./layout-stub";
import { setUrl } from "./nav-store";

const perm = vi.hoisted(() => ({ manage: true }));
vi.mock("@/lib/v2/hooks", async (orig) => {
  const m = await orig<typeof import("@/lib/v2/hooks")>();
  return { ...m, useV2Session: () => ({ ...m.useV2Session(), can: (a: string) => (a === "manage_rules" ? perm.manage : true) }) };
});
vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  setUrl("/fix-drafts");
  resetFixDrafts();
  perm.manage = true;
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("verified fixes", () => {
  it("formats coverage", () => {
    expect(coveragePct(244, 876)).toBe("27.9%");
    expect(coveragePct(0, 0)).toBe("0.0%");
  });

  it("shows coverage, a draft with codes beside text, and approves it", async () => {
    renderWithQuery(<ToastProvider><FixDrafts /></ToastProvider>);
    const cov = await screen.findByTestId("fix-coverage");
    expect(await within(cov).findByTestId("fix-cov-business_partner")).toBeInTheDocument();
    const card = await screen.findByTestId("fix-draft-MM_FIX_DEMO_1");
    expect(within(card).getByText("Material number must be upper case")).toBeInTheDocument();
    expect(within(card).getByText("Change to upper case")).toBeInTheDocument();
    fireEvent.click(within(card).getByTestId("fix-approve-MM_FIX_DEMO_1"));
    expect(screen.queryByText("Fix approved. The steps are now the rule's fix.")).toBeNull();
    fireEvent.click(within(card).getByTestId("fix-confirm-yes-MM_FIX_DEMO_1"));
    expect(await screen.findByText("Fix approved. The steps are now the rule's fix.")).toBeInTheDocument();
  });

  it("rejects a draft", async () => {
    renderWithQuery(<ToastProvider><FixDrafts /></ToastProvider>);
    fireEvent.click(await screen.findByTestId("fix-reject-SD_FIX_DEMO_2"));
    fireEvent.click(screen.getByTestId("fix-confirm-yes-SD_FIX_DEMO_2"));
    expect(await screen.findByText("Fix rejected.")).toBeInTheDocument();
  });
});

describe("verified fixes task flow", () => {
  it("shows four steps with the approve step current while drafts wait", async () => {
    renderWithQuery(<ToastProvider><FixDrafts /></ToastProvider>);
    const items = within(await screen.findByTestId("flow-steps")).getAllByRole("listitem");
    expect(items).toHaveLength(4);
    expect(items[3]).toHaveAttribute("aria-current", "step");
  });

  it("puts the drafts before coverage, keeps coverage and shape behind a disclosure, and states the consequence of approving", async () => {
    renderWithQuery(<ToastProvider><FixDrafts /></ToastProvider>);
    const list = await screen.findByTestId("fix-drafts-list");
    const card = await screen.findByTestId("fix-draft-MM_FIX_DEMO_1");
    const cov = await screen.findByTestId("fix-coverage-panel");
    expect(list.compareDocumentPosition(cov) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(cov.closest("details")).not.toBeNull();
    expect(within(card).getByText("What the failing values look like").closest("details")).not.toBeNull();
    expect(within(card).getAllByTestId("consequence")[0]).toHaveTextContent(/Nothing in SAP changes/);
  });

  it("hides approve and reject and says why without the manage rules permission", async () => {
    perm.manage = false;
    renderWithQuery(<ToastProvider><FixDrafts /></ToastProvider>);
    await screen.findByTestId("fix-draft-MM_FIX_DEMO_1");
    expect(screen.queryByTestId("fix-approve-MM_FIX_DEMO_1")).toBeNull();
    expect(screen.getByText("Managing rules needs the manage rules permission.")).toBeInTheDocument();
  });

  it("gives a next step when the list cannot be read", async () => {
    vi.spyOn(await import("@/lib/api/v2/fix-drafts"), "getFixDrafts").mockRejectedValue(new Error("down"));
    renderWithQuery(<ToastProvider><FixDrafts /></ToastProvider>);
    expect(await screen.findByText("The fix drafts could not be read.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry|try again/i })).toBeInTheDocument();
  });
});

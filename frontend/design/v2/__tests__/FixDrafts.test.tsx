import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { resetFixDrafts } from "@/lib/api/v2/fixtures/fixDrafts";
import { FixDrafts, coveragePct } from "../screens/FixDrafts";
import { ToastProvider } from "../Toast";
import { stubLayout } from "./layout-stub";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  setUrl("/fix-drafts");
  resetFixDrafts();
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
    expect(await screen.findByText("Fix approved. The steps are now the rule's fix.")).toBeInTheDocument();
  });

  it("rejects a draft", async () => {
    renderWithQuery(<ToastProvider><FixDrafts /></ToastProvider>);
    fireEvent.click(await screen.findByTestId("fix-reject-SD_FIX_DEMO_2"));
    expect(await screen.findByText("Fix rejected.")).toBeInTheDocument();
  });
});

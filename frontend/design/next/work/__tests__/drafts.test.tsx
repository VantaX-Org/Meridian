import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { stubLayout } from "@/design/v2/__tests__/layout-stub";
import { ToastProvider } from "../../kit";
import { WorkDrafts } from "../Drafts";
import { resetFixDrafts } from "@/lib/api/v2/fixtures/fixDrafts";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  resetFixDrafts();
});
afterEach(() => {
  undo();
  window.history.pushState({}, "", "/");
  window.sessionStorage.clear();
});

const fx = (u: string) => { window.history.pushState({}, "", u); setUrl(u); };
const page = () => renderWithQuery(<ToastProvider><WorkDrafts /></ToastProvider>);

describe("Work drafts", () => {
  it("lists the drafted fixes with their proof and the coverage", async () => {
    fx("/next/work/drafts?fixture=1");
    page();
    expect(await screen.findByTestId("fix-draft-MM_FIX_DEMO_1")).toBeTruthy();
    expect(screen.getByTestId("fix-proof-MM_FIX_DEMO_1")).toBeTruthy();
    expect(await screen.findByTestId("fix-coverage")).toBeTruthy();
  });

  it("approves a draft after a confirm", async () => {
    fx("/next/work/drafts?fixture=1");
    page();
    await userEvent.click(await screen.findByTestId("fix-approve-MM_FIX_DEMO_1"));
    await userEvent.click(await screen.findByRole("button", { name: "Yes, approve" }));
    await waitFor(() => expect(screen.getByText("Fix approved. The steps are now the rule's fix.")).toBeTruthy());
  });

  it("shows the gate and no decision buttons to a viewer", async () => {
    fx("/next/work/drafts?fixture=1&role=viewer");
    page();
    expect(await screen.findByTestId("fix-draft-MM_FIX_DEMO_1")).toBeTruthy();
    expect(screen.getByText("Managing rules needs the manage rules permission.")).toBeTruthy();
    expect(screen.queryByTestId("fix-approve-MM_FIX_DEMO_1")).toBeNull();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { ToastProvider } from "@/design/next/kit";
import { approvalState } from "@/lib/api/next/load";
import type { LoadApproval } from "@/lib/api/v2/migration";
import { ApprovePanel } from "../Approve";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

beforeEach(() => window.sessionStorage.setItem("mn_v2_fixture", "1"));
afterEach(() => { window.sessionStorage.clear(); vi.clearAllMocks(); });

const base: LoadApproval = {
  run_id: "r", prepared_by: "u1", prepared_by_label: "Thabo", prepared_at: "2026-11-12T10:00:00Z",
  decision: null, decided_by: null, decided_by_label: null, decided_at: null, comment: null,
};

describe("the server state becomes the approval state", () => {
  it("counts the preparer as the first approval and nobody as the second", () => {
    const s = approvalState(base);
    expect(s.first?.name).toBe("Thabo");
    expect(s.second).toBeUndefined();
    expect(s.rejected).toBeUndefined();
  });
  it("maps an approved decision to the second approval", () => {
    const s = approvalState({ ...base, decision: "approved", decided_by: "u2", decided_by_label: "Ana", decided_at: "2026-11-12T11:00:00Z" });
    expect(s.second).toEqual({ id: "u2", name: "Ana", at: "2026-11-12T11:00:00Z" });
  });
  it("maps a rejection with its comment", () => {
    const s = approvalState({ ...base, decision: "rejected", decided_by: "u2", decided_by_label: "Ana", decided_at: "2026-11-12T11:00:00Z", comment: "Wrong plant" });
    expect(s.rejected?.comment).toBe("Wrong plant");
    expect(s.second).toBeUndefined();
  });
});

describe("the approval panel talks to the server", () => {
  const panel = () => renderWithQuery(<ToastProvider><ApprovePanel runId="mig-0002" /></ToastProvider>);

  it("shows the preparer as the first approval and waits for the second", async () => {
    panel();
    expect(await screen.findByText("Pat Preparer")).toBeTruthy();
    expect(screen.queryByText("Give the first approval")).toBeNull();
    expect(screen.getByTestId("approve-second").textContent).toContain("Waiting");
  });

  it("gives the second approval through the API and shows who gave it", async () => {
    panel();
    fireEvent.click(await screen.findByRole("button", { name: "Give the second approval" }));
    await waitFor(() => expect(screen.getByTestId("approve-second").textContent).toContain("Resh Naidoo"));
    expect(screen.queryByRole("button", { name: "Give the second approval" })).toBeNull();
  });
});

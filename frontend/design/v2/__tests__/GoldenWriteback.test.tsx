import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { resetMdmFixture } from "@/lib/api/v2/fixtures/mdm";
import { changedFields, FieldHistory, PromoteAction, SendToSap } from "../inspector/golden-writeback";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

let granted: string[] = ["apply", "approve"];
vi.mock("@/lib/v2/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/v2/hooks")>();
  return {
    ...actual,
    useV2Session: () => ({ persona: "lead" as const, label: "Programme lead", name: "Test", email: null, id: "u-me", fixture: true, can: (a: string) => granted.includes(a) }),
  };
});

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  granted = ["apply", "approve"];
  resetMdmFixture();
  setUrl("/?fixture=1");
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("changedFields", () => {
  it("lists only the fields whose value differs", () => {
    expect(changedFields({ a: "1", b: "2" }, { a: "1", b: "3", c: "4" }).map((c) => c.field ?? c)).toEqual(expect.arrayContaining(["b", "c"]));
    expect(changedFields({ a: "1" }, { a: "1" })).toHaveLength(0);
  });
});

describe("the change history", () => {
  it("shows who changed the record and how", async () => {
    renderWithQuery(<FieldHistory id="gr-1" />);
    expect(await screen.findByText("Change history")).toBeInTheDocument();
    expect(await screen.findAllByText(/A\. Naidoo/)).not.toHaveLength(0);
  });
});

describe("promote", () => {
  it("promotes a record that waits for review", async () => {
    renderWithQuery(<PromoteAction id="gr-4" />);
    fireEvent.click(await screen.findByRole("button", { name: "Promote to golden" }));
    expect(await screen.findByText("Promoted to golden")).toBeInTheDocument();
  });
  it("hides the action without the approve permission", () => {
    granted = [];
    renderWithQuery(<PromoteAction id="gr-4" />);
    expect(screen.queryByRole("button", { name: "Promote to golden" })).toBeNull();
  });
});

describe("send to SAP", () => {
  it("asks for a promotion first when the record is not golden", () => {
    renderWithQuery(<SendToSap id="gr-4" status="pending_review" />);
    expect(screen.getByText(/Promote this record to golden first/)).toBeInTheDocument();
  });

  it("checks with SAP then sends for approval, and the requester cannot approve", async () => {
    renderWithQuery(<SendToSap id="gr-1" status="golden" />);
    fireEvent.click(await screen.findByRole("button", { name: "Check with SAP" }));
    fireEvent.click(await screen.findByRole("button", { name: "Send for approval" }));
    expect(await screen.findByText("Waiting for a second person")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("lets a second person approve a request from someone else", async () => {
    renderWithQuery(<SendToSap id="gr-0" status="golden" />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    const dlg = await screen.findByRole("dialog");
    fireEvent.click(within(dlg).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(screen.getByText("Approved, waiting to be written")).toBeInTheDocument());
  });

  it("lets a second person reject", async () => {
    renderWithQuery(<SendToSap id="gr-0" status="golden" />);
    fireEvent.click(await screen.findByRole("button", { name: "Reject" }));
    await waitFor(() => expect(screen.getByText("Rejected", { selector: "span, td, strong, b, dd" })).toBeInTheDocument());
  });
});

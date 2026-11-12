import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { Exceptions } from "../screens/Exceptions";
import { resetExceptionsFixture } from "@/lib/api/v2/fixtures/exceptions";
import { setUrl } from "./nav-store";
import { stubLayout } from "./layout-stub";

const h = vi.hoisted(() => ({ allowed: "all" as "all" | string[] }));

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("@/lib/v2/hooks", async (orig) => {
  const m = await orig<typeof import("@/lib/v2/hooks")>();
  return { ...m, useV2Session: () => ({ persona: "lead", label: "Programme lead", name: "Test", email: null, id: "u-me", fixture: true, shared: false, can: (a: string) => h.allowed === "all" || h.allowed.includes(a) }) };
});

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  h.allowed = "all";
  resetExceptionsFixture();
  setUrl("/work/exceptions?fixture=1");
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("Exceptions", () => {
  it("counts the open exceptions in the banner and lists them nearest SLA first", async () => {
    renderWithQuery(<Exceptions />);
    const banner = await screen.findByTestId("exceptions-banner");
    expect(banner.textContent).toContain("5 exceptions still open");
    const table = await screen.findByTestId("exceptions-table");
    expect(table.textContent).toContain("Goods receipt posted to a blocked material");
    expect(table.textContent).toContain("MIGO 5000412233");
  });

  it("escalates an open exception one tier and notes why", async () => {
    renderWithQuery(<Exceptions />);
    fireEvent.click(await screen.findByRole("button", { name: "Goods receipt posted to a blocked material" }));
    const form = await screen.findByRole("form", { name: "Escalate the exception" });
    fireEvent.change(within(form).getByRole("textbox"), { target: { value: "Stock already consumed" } });
    fireEvent.click(within(form).getByRole("button", { name: "Escalate to tier 2" }));
    await waitFor(() => expect(screen.getByTestId("exceptions-comments").textContent).toContain("Escalated to tier 2: Stock already consumed"));
  });

  it("hides escalate and resolve from a role without approve", async () => {
    h.allowed = ["assign"];
    renderWithQuery(<Exceptions />);
    fireEvent.click(await screen.findByRole("button", { name: "Goods receipt posted to a blocked material" }));
    await screen.findByRole("form", { name: "Assign the exception" });
    expect(screen.queryByRole("form", { name: "Escalate the exception" })).toBeNull();
    expect(screen.queryByRole("form", { name: "Resolve the exception" })).toBeNull();
  });

  it("leads with the table and three steps; the severity chart and rules sit in one closed disclosure after it", async () => {
    renderWithQuery(<Exceptions />);
    const table = await screen.findByTestId("exceptions-table");
    expect(within(screen.getByTestId("flow-steps")).getAllByRole("listitem")).toHaveLength(3);
    const more = screen.getByTestId("more-detail");
    expect(more).not.toHaveAttribute("open");
    expect(more).toContainElement(screen.getByTestId("exceptions-severity"));
    expect(table.compareDocumentPosition(more) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("moves to step two and says what Assign, Escalate and Resolve do once one is open", async () => {
    renderWithQuery(<Exceptions />);
    fireEvent.click(await screen.findByRole("button", { name: "Goods receipt posted to a blocked material" }));
    expect(await screen.findByText("Assign makes the person the owner. The exception stays open.")).toBeInTheDocument();
    expect(screen.getByText(/Escalate raises the exception one tier\. Resolve closes it/)).toBeInTheDocument();
    expect(within(screen.getByTestId("flow-steps")).getAllByRole("listitem")[1]).toHaveAttribute("aria-current", "step");
  });

  it("shows no consequence lines to a role that can neither assign nor approve", async () => {
    h.allowed = ["view"];
    renderWithQuery(<Exceptions />);
    fireEvent.click(await screen.findByRole("button", { name: "Goods receipt posted to a blocked material" }));
    await screen.findByTestId("exceptions-detail");
    expect(screen.queryByText(/Assign makes the person the owner/)).toBeNull();
    expect(screen.queryByText(/Escalate raises the exception/)).toBeNull();
  });

  it("says what failed and offers a retry when the exceptions cannot be read", async () => {
    const api = await import("@/lib/api/v2/exceptions");
    vi.spyOn(api, "getExceptions").mockRejectedValue(new Error("boom"));
    renderWithQuery(<Exceptions />);
    expect(await screen.findByText("The exceptions could not be read.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("raises an exception by hand and shows it in the table", async () => {
    renderWithQuery(<Exceptions />);
    await screen.findByTestId("exceptions-table");
    fireEvent.click(screen.getByTestId("raise-exception-open"));
    const form = await screen.findByRole("form", { name: "Raise an exception" });
    const submit = within(form).getByRole("button", { name: "Raise exception" });
    expect(submit).toBeDisabled();
    const boxes = within(form).getAllByRole("textbox");
    fireEvent.change(boxes[0], { target: { value: "Price list gap for new plant" } });
    fireEvent.change(boxes[1], { target: { value: "pricing" } });
    fireEvent.change(boxes[2], { target: { value: "No price for plant 4100" } });
    fireEvent.click(submit);
    await waitFor(() => expect(screen.getByTestId("exceptions-table").textContent).toContain("Price list gap for new plant"));
  });

  it("creates an exception rule that starts off", async () => {
    renderWithQuery(<Exceptions />);
    fireEvent.click(await screen.findByTestId("new-rule-open"));
    const form = await screen.findByTestId("new-rule");
    const submit = within(form).getByRole("button", { name: "Create rule" });
    expect(submit).toBeDisabled();
    const boxes = within(form).getAllByRole("textbox");
    fireEvent.change(boxes[0], { target: { value: "Blocked material receipt" } });
    fireEvent.change(boxes[1], { target: { value: "Receipt on a blocked material" } });
    fireEvent.change(boxes[2], { target: { value: "material" } });
    fireEvent.change(boxes[3], { target: { value: "status = blocked" } });
    fireEvent.click(submit);
    await waitFor(() => expect(screen.queryByTestId("new-rule")).toBeNull());
    expect(screen.getByTestId("new-rule-open")).toBeInTheDocument();
  });

  it("hides raise and new rule from a role without the permission", async () => {
    h.allowed = ["assign"];
    renderWithQuery(<Exceptions />);
    await screen.findByTestId("exceptions-table");
    expect(screen.queryByTestId("raise-exception-open")).toBeNull();
    expect(screen.queryByTestId("new-rule-open")).toBeNull();
  });
});

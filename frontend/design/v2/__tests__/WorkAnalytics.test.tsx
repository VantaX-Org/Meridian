import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { WorkAnalytics } from "../screens/WorkAnalytics";
import { stubLayout } from "./layout-stub";
import { setUrl } from "./nav-store";
import * as wa from "@/lib/api/v2/work-analytics";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  setUrl("/work/analytics");
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("Work analytics", () => {
  it("shows the open issues, the finish date and the burn-down", async () => {
    renderWithQuery(<WorkAnalytics />);
    const banner = await screen.findByTestId("wa-banner");
    expect(banner.textContent).toMatch(/issues open/);
    expect(banner.textContent).toMatch(/clear by/);
    expect(screen.getByRole("link", { name: "Analytics" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("wa-burndown")).toBeInTheDocument();
  });

  it("shows the cleaning engine pace", async () => {
    renderWithQuery(<WorkAnalytics />);
    const pace = await screen.findByTestId("wa-cleaning-pace");
    expect(await within(pace).findByText("69,331")).toBeInTheDocument();
    expect(pace.textContent).toContain("38.2%");
    expect(pace.textContent).toContain("6.4 hours");
  });

  it("names the rules the latest run changed and shows a dash for a source with nothing proposed", async () => {
    renderWithQuery(<WorkAnalytics />);
    const change = await screen.findByTestId("wa-run-change");
    expect(await within(change).findByText("MM302")).toBeInTheDocument();
    const proposals = await screen.findByTestId("wa-proposals");
    const row = (await within(proposals).findByText("Simulations")).closest("tr")!;
    expect(row.textContent).toContain("—");
  });

  it("ranks the rules stewards call wrong and opens the notes behind one", async () => {
    renderWithQuery(<WorkAnalytics />);
    const fb = await screen.findByTestId("wa-rule-feedback");
    const row = (await within(fb).findByText("MM035")).closest("tr")!;
    expect(row.textContent).toContain("77.8%");
    fireEvent.click(within(row).getByRole("button", { name: "Show why" }));
    expect(await within(fb).findByText("Plant is closed; the material is kept only for history")).toBeInTheDocument();
  });

  it("puts the trend and the steps first and keeps the diagnostic panels one click away", async () => {
    renderWithQuery(<WorkAnalytics />);
    const steps = await screen.findByTestId("flow-steps");
    expect(steps.querySelector("[aria-current=step]")?.textContent).toContain("Read the trend");
    expect(screen.getByTestId("consequence").textContent).toContain("only reads");
    const more = screen.getByTestId("more-detail");
    expect(more.hasAttribute("open")).toBe(false);
    expect(screen.getByTestId("wa-burndown").compareDocumentPosition(more) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(more.contains(await screen.findByTestId("wa-throughput"))).toBe(true);
    expect(more.contains(screen.getByTestId("wa-run-change"))).toBe(false);
  });

  it("shows a retry when the analytics cannot be read", async () => {
    vi.spyOn(wa, "getBurndown").mockRejectedValue(Object.assign(new Error("x"), { status: 500 }));
    renderWithQuery(<WorkAnalytics />);
    expect(await screen.findByText("The work analytics could not be read.", {}, { timeout: 4000 })).toBeInTheDocument();
  });

  it("tells a role without access that it cannot read the analytics", async () => {
    vi.spyOn(wa, "getBurndown").mockRejectedValue(Object.assign(new Error("x"), { status: 403 }));
    renderWithQuery(<WorkAnalytics />);
    expect(await screen.findByText("Your role cannot read the work analytics.")).toBeInTheDocument();
  });
});

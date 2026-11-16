import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { ToastProvider } from "../../kit";
import { useObjectRun, type ObjectRun } from "../useObjectRun";
import { ReadinessTab } from "../tabs/ReadinessTab";
import { ProcessesTab } from "../tabs/ProcessesTab";
import { LineageTab } from "../tabs/LineageTab";
import { ProfileTab } from "../tabs/ProfileTab";
import { GlossaryTab } from "../tabs/GlossaryTab";
import { GoldenTab } from "../tabs/GoldenTab";
import { TrendTab } from "../tabs/TrendTab";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

const Q = vi.hoisted(() => ({ can: (() => true) as (a: string) => boolean }));
vi.mock("@/lib/v2/hooks", async (orig) => ({ ...(await orig<object>()), useV2Session: () => ({ can: Q.can, id: "me", name: "Me", email: "me@example.com", persona: "admin", label: "Admin", fixture: true, viewAs: null, shared: false }) }));

function Harness({ Tab }: { Tab: (p: { o: ObjectRun }) => React.ReactElement }) {
  const o = useObjectRun("ecc-production", "material-master");
  return <Tab o={o} />;
}
const wrap = (Tab: (p: { o: ObjectRun }) => React.ReactElement) =>
  renderWithQuery(
    <ToastProvider>
      <Harness Tab={Tab} />
    </ToastProvider>,
  );

beforeEach(() => {
  setUrl("/o/ecc-production/material-master?fixture=1");
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  Q.can = () => true;
});

describe("object tabs, fork G (next)", () => {
  it.each([
    ["tab-readiness", ReadinessTab],
    ["tab-processes", ProcessesTab],
    ["tab-lineage", LineageTab],
    ["tab-profile", ProfileTab],
    ["tab-glossary", GlossaryTab],
    ["tab-golden", GoldenTab],
    ["tab-trend", TrendTab],
  ] as const)("renders %s from fixtures", async (id, Tab) => {
    wrap(Tab);
    await waitFor(() => expect(screen.getByTestId(id)).toBeTruthy(), { timeout: 4000 });
  });

  it("sends a chosen match pair to a steward", async () => {
    wrap(GoldenTab);
    const section = await screen.findByTestId("golden-candidates");
    const boxes = await within(section).findAllByRole("checkbox");
    fireEvent.click(boxes[0]);
    fireEvent.click(within(section).getByRole("button", { name: "Send 1 to a steward" }));
    await waitFor(() => expect(screen.getByText(/on the stewardship queue as merge decisions/)).toBeTruthy());
  });

  it("hides choosing and sending without the approve permission", async () => {
    Q.can = (a) => a !== "approve";
    wrap(GoldenTab);
    const section = await screen.findByTestId("golden-candidates");
    await waitFor(() => expect(within(section).getAllByRole("link", { name: "Review" }).length).toBeGreaterThan(0));
    expect(within(section).queryAllByRole("checkbox")).toHaveLength(0);
    expect(within(section).queryByRole("group", { name: "Send pairs to the stewardship queue" })).toBeNull();
  });

  it("explains why a backwards run comparison cannot open", async () => {
    wrap(TrendTab);
    await screen.findByTestId("tab-trend");
    const later = screen.getByRole("combobox", { name: "Later run" }) as HTMLSelectElement;
    const earlier = screen.getByRole("combobox", { name: "Earlier run" }) as HTMLSelectElement;
    fireEvent.change(later, { target: { value: earlier.value } });
    expect(screen.getByTestId("compare-order").textContent).toBe("Pick two different runs.");
  });

  it("offers the trend runs as CSV and labels each point", async () => {
    wrap(TrendTab);
    await screen.findByTestId("tab-trend");
    await waitFor(() => expect(screen.getAllByTestId("export-csv").length).toBeGreaterThan(0));
    const chart = screen.getByTestId("trend-chart");
    expect(chart.querySelector(".nx-varea-axis span")).not.toBeNull();
  });
});

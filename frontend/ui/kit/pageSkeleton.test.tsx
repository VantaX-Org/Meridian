import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { KpiStrip } from "./KpiStrip";
import { PageHeader } from "./PageHeader";

describe("PageHeader v2", () => {
  it("renders trail, status, meta (max five, blanks dropped), stepper and tabs slots", () => {
    const { container } = render(
      <PageHeader title="Material" crumbs={[{ label: "Objects", href: "/o" }, { label: "Material" }]} status={<span>Ready</span>}
        meta={["ECC", null, "Run 8", "", "a", "b", "c", "d"]} stepper={<div>step</div>} tabs={<div>tabs</div>} />,
    );
    expect(container.querySelector(".mx-page-crumbs a")?.getAttribute("href")).toBe("/o");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Ready");
    expect(container.querySelectorAll(".mx-head-meta li").length).toBe(5);
    expect(screen.getByText("step")).toBeTruthy();
    expect(screen.getByText("tabs")).toBeTruthy();
  });
  it("omits empty rows", () => {
    const { container } = render(<PageHeader title="X" meta={[null]} />);
    expect(container.querySelector(".mx-head-meta")).toBeNull();
    expect(container.querySelector(".mx-page-crumbs")).toBeNull();
  });
});

describe("KpiStrip", () => {
  it("shows a dash for no data, delta words, and links a cell", () => {
    render(<KpiStrip label="Glance" cells={[
      { label: "Score", value: "82", delta: { text: "+1.4 since run 7", dir: "up", tone: "good" } },
      { label: "Runs", value: null, note: "No runs yet" },
      { label: "Objects", value: "9", href: "/o" },
    ]} />);
    const list = screen.getByLabelText("Glance");
    expect(within(list).getByText("+1.4 since run 7")).toBeTruthy();
    expect(within(list).getByText("—")).toBeTruthy();
    expect(within(list).getByText("No runs yet")).toBeTruthy();
    expect(list.querySelector("a")?.getAttribute("href")).toBe("/o");
  });
});

// frontend/design/templates/__tests__/InsightHeader.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { InsightHeader } from "../InsightHeader";

const cells = {
  situation: { sentence: "One" },
  changed: { sentence: "Two" },
  why: { sentence: "Three" },
  next: { sentence: "Four" },
};

describe("InsightHeader", () => {
  it("is a plain sheet unless hero is set", () => {
    const { container } = render(<InsightHeader {...cells} stats={[{ label: "A", value: 1 }]} />);
    expect(container.querySelector(".m-hero")).toBeNull();
    expect(screen.queryByTestId("insight-hero-stats")).toBeNull();
  });

  it("renders a hero band with at most four hero stats", () => {
    const stats = ["A", "B", "C", "D", "E"].map((label, i) => ({ label, value: i }));
    const { container } = render(<InsightHeader {...cells} hero stats={stats} />);
    expect(container.querySelector("section")).toHaveClass("m-hero");
    expect(screen.getByTestId("insight-hero-stats").children).toHaveLength(4);
    expect(screen.queryByText("E")).toBeNull();
  });

  it("stacks the lead above the stats until the container is wide enough for both side by side", () => {
    const stats = ["A", "B", "C"].map((label, i) => ({ label, value: i }));
    render(<InsightHeader {...cells} hero lead={<p>Fail</p>} stats={stats} />);
    const lead = screen.getByTestId("insight-hero-lead");
    const band = lead.parentElement!;
    // Side by side only from the 7xl container size; below it one column, so the verdict never paints over a stat.
    expect(band.className).toContain("@7xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]");
    expect(band.className).not.toMatch(/(^|\s)@5xl:grid-cols/);
    expect(lead).toHaveClass("min-w-0");
    expect(screen.getByTestId("insight-hero-stats").className).toContain("@3xl:grid-cols-3");
  });

  it("prints hero numbers with thousands separators", () => {
    render(<InsightHeader {...cells} hero stats={[{ label: "Records fixed", value: 10521 }, { label: "DQS", value: 70, decimals: 1 }]} />);
    expect(screen.getByLabelText("10,521")).toBeInTheDocument();
    expect(screen.getByLabelText("70.0")).toBeInTheDocument();
  });
});

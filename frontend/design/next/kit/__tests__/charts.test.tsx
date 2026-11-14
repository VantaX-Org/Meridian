import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AreaSpark, Ring, SegBar } from "../charts";

describe("chart parts", () => {
  it("Ring labels itself and draws an arc for a value", () => {
    const { container } = render(<Ring value={50} label="DQS 50 of 100">50</Ring>);
    expect(screen.getByRole("img", { name: "DQS 50 of 100" })).toBeTruthy();
    expect(container.querySelector(".nx-ring-arc")).not.toBeNull();
  });
  it("Ring with no value draws the track only", () => {
    const { container } = render(<Ring value={null} label="Not scored yet" />);
    expect(container.querySelector(".nx-ring-arc")).toBeNull();
    expect(container.querySelector(".nx-ring-track")).not.toBeNull();
  });
  it("AreaSpark draws a dot with a tooltip per point", () => {
    const pts = Array.from({ length: 9 }, (_, i) => ({ label: `Run ${i + 1}`, value: 60 + i }));
    const { container } = render(<AreaSpark points={pts} label="trend" />);
    expect(container.querySelectorAll(".nx-area-dot title")).toHaveLength(9);
    expect(screen.getByRole("img", { name: "trend" })).toBeTruthy();
  });
  it("AreaSpark with under two points shows the empty shape and one line", () => {
    render(<AreaSpark points={[{ label: "Run 1", value: 70 }]} label="trend" empty="Not enough runs" />);
    expect(screen.getByText("Not enough runs")).toBeTruthy();
  });
  it("SegBar writes its parts in the label and gives each part a tooltip", () => {
    const { container } = render(<SegBar label="Fix" format={String} segments={[{ label: "A", value: 3 }, { label: "B", value: 0 }, { label: "C", value: 1 }]} />);
    expect(screen.getByRole("img", { name: "Fix: A 3, B 0, C 1" })).toBeTruthy();
    expect(container.querySelectorAll(".nx-segbar-part[title]")).toHaveLength(2);
  });
  it("SegBar with all zero draws an empty bar", () => {
    const { container } = render(<SegBar label="Fix" format={String} segments={[{ label: "A", value: 0 }]} />);
    expect(container.querySelector('[data-i="empty"]')).not.toBeNull();
  });
});

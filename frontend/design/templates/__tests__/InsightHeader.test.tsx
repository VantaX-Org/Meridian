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
});

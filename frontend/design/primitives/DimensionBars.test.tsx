import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DimensionBars } from "./DimensionBars";

describe("DimensionBars", () => {
  it("renders a row per item, linking only those with an href, and an en dash for null", () => {
    render(<DimensionBars items={[
      { key: "a", label: "Completeness", score: 91.2, href: "/objects?dimension=a" },
      { key: "b", label: "Validity", score: null },
    ]} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByText("–")).toBeTruthy();
  });
});

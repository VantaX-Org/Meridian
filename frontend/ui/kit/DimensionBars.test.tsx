import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DimensionBars } from "./DimensionBars";

describe("DimensionBars", () => {
  it("lists every dimension with its value or n/a", () => {
    render(<DimensionBars naLabel="n/a" items={[{ key: "a", label: "Completeness", value: 91 }, { key: "b", label: "Validity", value: null }]} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("91")).toBeTruthy();
    expect(screen.getByText("n/a")).toBeTruthy();
  });
});

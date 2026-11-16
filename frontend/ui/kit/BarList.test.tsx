import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BarList } from "./BarList";

describe("BarList", () => {
  it("scales bars to the largest value", () => {
    const { container } = render(<BarList label="Top" items={[{ id: "a", label: "A", value: 50, display: "50 records" }, { id: "b", label: "B", value: 25, sev: "high" }]} />);
    expect(screen.getByRole("list", { name: "Top" })).toBeTruthy();
    expect(screen.getByText("50 records")).toBeTruthy();
    const w = [...container.querySelectorAll(".mx-bar > span")].map((e) => (e as HTMLElement).style.inlineSize);
    expect(w).toEqual(["100%", "50%"]);
  });
});

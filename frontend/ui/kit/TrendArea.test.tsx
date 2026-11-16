import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TrendArea } from "./TrendArea";

describe("TrendArea", () => {
  it("renders a labelled chart for two or more points", () => {
    render(<TrendArea label="Score over runs" emptyLabel="One run only" points={[{ axis: "1 Nov", title: "Run 1", value: 60 }, { axis: "8 Nov", title: "Run 2", value: 70 }]} />);
    expect(screen.getByRole("img", { name: "Score over runs" })).toBeTruthy();
  });
  it("shows the empty text for one run", () => {
    render(<TrendArea label="x" emptyLabel="One run only" points={[{ axis: "a", title: "r", value: 60 }]} />);
    expect(screen.getByText("One run only")).toBeTruthy();
  });
});

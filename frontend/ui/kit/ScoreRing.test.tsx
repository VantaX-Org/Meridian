import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScoreRing } from "./ScoreRing";

describe("ScoreRing", () => {
  it("labels the score", () => {
    render(<ScoreRing value={70.4} label="Data quality score" naLabel="n/a" />);
    expect(screen.getByRole("img", { name: "Data quality score: 70.4" })).toBeTruthy();
  });
  it("shows the n/a label with no value", () => {
    render(<ScoreRing value={null} label="Score" naLabel="n/a" />);
    expect(screen.getByRole("img", { name: "Score: n/a" })).toBeTruthy();
  });
});

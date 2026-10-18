import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DimensionBars, DimensionStrip } from "./DimensionBars";

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

describe("DimensionStrip", () => {
  it("fills one track per measured dimension from the bottom in its tone, and names every dimension", () => {
    render(<DimensionStrip items={[
      { key: "c", label: "Completeness", score: 99 },
      { key: "a", label: "Accuracy", score: 0 },
      { key: "v", label: "Validity", score: null },
    ]} />);
    const strip = screen.getByRole("img", { name: "Completeness 99.0, Accuracy 0.0, Validity not measured" });
    const tracks = [...strip.querySelectorAll<HTMLElement>(".m-dim-strip-track")];
    expect(tracks.map((t) => t.dataset.measured)).toEqual(["true", "true", "false"]);
    const fills = [...strip.querySelectorAll<HTMLElement>(".m-bar-fill")];
    // a score of 0 keeps a sliver, so it never reads as not measured
    expect(fills.map((f) => [f.dataset.tone, f.style.height])).toEqual([["pass", "99%"], ["critical", "12%"]]);
  });
});

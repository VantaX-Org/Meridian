import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Card } from "./Card";

describe("Card", () => {
  it("is a labelled region with title, sub and body", () => {
    render(<Card title="Score" sub="Latest run"><p>Body</p></Card>);
    expect(screen.getByRole("region", { name: "Score" })).toBeTruthy();
    expect(screen.getByText("Latest run")).toBeTruthy();
    expect(screen.getByText("Body")).toBeTruthy();
  });
});

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DqsPair } from "./DqsPair";

describe("DqsPair", () => {
  it("shows each row and reason", () => {
    render(<DqsPair naLabel="n/a" rows={[{ key: "source", label: "Source", value: 72 }, { key: "actual", label: "Target", value: null }]} reasons={[{ label: "Merged duplicates", value: "+3" }]} />);
    expect(screen.getByText("72")).toBeTruthy();
    expect(screen.getByText("n/a")).toBeTruthy();
    expect(screen.getByText("Merged duplicates")).toBeTruthy();
  });
});

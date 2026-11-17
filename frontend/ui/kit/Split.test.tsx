import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Split } from "./Split";

describe("Split", () => {
  it("renders two labelled columns", () => {
    render(<Split left="L" right="R" leftLabel="List" rightLabel="Detail" />);
    expect(screen.getByRole("region", { name: "List" }).textContent).toBe("L");
    expect(screen.getByRole("region", { name: "Detail" }).textContent).toBe("R");
  });
});

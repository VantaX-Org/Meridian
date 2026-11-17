import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FieldChip } from "./FieldChip";

describe("FieldChip", () => {
  it("shows code and description", () => {
    render(<FieldChip code="MARA-MEINS" description="Base unit of measure" />);
    expect(screen.getByText("MARA-MEINS").tagName).toBe("CODE");
    expect(screen.getByText("Base unit of measure")).toBeTruthy();
  });
});

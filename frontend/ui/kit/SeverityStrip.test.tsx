import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SeverityStrip } from "./SeverityStrip";

describe("SeverityStrip", () => {
  it("shows a tile per severity", () => {
    render(<SeverityStrip rulesLabel={(n) => `${n} rules`} tiles={[{ sev: "critical", label: "Critical", rules: 2, records: "1.2k records" }, { sev: "high", label: "High", rules: 5, records: "300 records" }]} />);
    expect(screen.getByText("Critical")).toBeTruthy();
    expect(screen.getByText("5 rules")).toBeTruthy();
    expect(screen.getByText("1.2k records")).toBeTruthy();
  });
});

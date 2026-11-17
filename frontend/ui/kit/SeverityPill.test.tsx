import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SeverityPill } from "./SeverityPill";

describe("SeverityPill", () => {
  it("shows the label and carries the severity", () => {
    render(<SeverityPill sev="critical" label="Critical" />);
    expect(screen.getByText("Critical").closest("[data-sev]")?.getAttribute("data-sev")).toBe("critical");
  });
});

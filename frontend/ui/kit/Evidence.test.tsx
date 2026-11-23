import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BandChart } from "./BandChart";
import { AletheiaMark, EvidenceNote } from "./Evidence";

describe("EvidenceNote", () => {
  it("lists inputs, method, confidence and the runs used", () => {
    render(<EvidenceNote testId="ev" ev={{ inputs: ["run scores", "rule counts"], method: "Linear trend", confidence: 82, runs: 6, first_run: "2026-09-01T00:00:00Z", last_run: "2026-10-30T00:00:00Z" }} />);
    const ev = screen.getByTestId("ev");
    expect(ev.textContent).toContain("run scores; rule counts");
    expect(ev.textContent).toContain("Linear trend");
    expect(ev.textContent).toContain("82 out of 100");
    expect(ev.textContent).toContain("2026-09-01 to 2026-10-30");
  });
  it("says confidence is per result when the engine gives none", () => {
    render(<EvidenceNote testId="ev" ev={{ inputs: ["x"], method: "z-score", confidence: null }} />);
    expect(screen.getByTestId("ev").textContent).toContain("Shown per result");
  });
});

describe("AletheiaMark and BandChart", () => {
  it("shows the licensed mark with the name", () => {
    const { container } = render(<AletheiaMark />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/brand/aletheia-mark.svg");
    expect(container.textContent).toContain("Aletheia");
  });
  it("renders a labelled band chart", () => {
    render(<BandChart label="Projected score" target={80} data={[{ axis: "a", value: 70 }, { axis: "b", point: 74, low: 71, high: 77 }]} />);
    expect(screen.getByRole("img", { name: /^Projected score/ })).toBeTruthy();
  });
});

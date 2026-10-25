import { describe, expect, it } from "vitest";
import { reportFilename } from "../report-filename";

const day = new Date(2026, 9, 25, 21, 30);

describe("reportFilename", () => {
  it("names the report, the scope and the day", () => {
    expect(reportFilename("board", "ECC PRD", day)).toBe("Meridian board pack – ECC PRD – 2026-10-25.pdf");
    expect(reportFilename("workbook", "ECC PRD", day)).toBe("Meridian analyst workbook – ECC PRD – 2026-10-25.xlsx");
    expect(reportFilename("run_data", "latest run", day)).toBe("Meridian run data – latest run – 2026-10-25.json");
  });

  it("takes a catalogue entry's own name and extension, keeping a leading acronym", () => {
    expect(reportFilename({ name: "Comparison report", ext: "pdf" }, "Run 2", day)).toBe("Meridian comparison report – Run 2 – 2026-10-25.pdf");
    expect(reportFilename({ name: "SAP extract", ext: "xlsx" }, "Run 2", day)).toBe("Meridian SAP extract – Run 2 – 2026-10-25.xlsx");
  });

  it("drops a missing scope and strips characters a file system refuses", () => {
    expect(reportFilename("board", undefined, day)).toBe("Meridian board pack – 2026-10-25.pdf");
    expect(reportFilename("board", "  ", day)).toBe("Meridian board pack – 2026-10-25.pdf");
    expect(reportFilename("board", "ECC/PRD: wave 1?", day)).toBe("Meridian board pack – ECC-PRD- wave 1- – 2026-10-25.pdf");
  });

  it("reads an ISO date string and drops an unreadable one", () => {
    expect(reportFilename("board", "ECC PRD", "2026-10-25T12:00:00")).toBe("Meridian board pack – ECC PRD – 2026-10-25.pdf");
    expect(reportFilename("board", "ECC PRD", "not a date")).toBe("Meridian board pack – ECC PRD.pdf");
  });
});

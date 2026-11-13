import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { destinationAt, destinations } from "@/design/v2/shell/menu";
import { chapterFor } from "@/lib/v2/help";
import { FIXTURE_MODULE, FIXTURE_SYSTEM } from "@/lib/api/next/runs-fixture";
import { newestRun, runLabel, SourceRunPicker } from "../SourceRunPicker";
import type { VersionHead } from "@/lib/api/v2/runs";

beforeEach(() => window.sessionStorage.setItem("mn_v2_fixture", "1"));
afterEach(() => window.sessionStorage.clear());

describe("Load menu", () => {
  const load = destinations().find((d) => d.id === "load");
  it("is a top-level place at /load with the key l", () => {
    expect(load?.href).toBe("/load");
    expect(load?.key).toBe("l");
    expect(destinations().some((d) => (d.id as string) === "migration")).toBe(false);
  });
  it("lists Prepare first and the moved pages under /load", () => {
    const hrefs = load!.kids.map((k) => k.href);
    expect(hrefs[0]).toBe("/load");
    expect(hrefs).toEqual(expect.arrayContaining(["/migration", "/load/compare", "/load/plan", "/load/s4", "/load/go-live", "/load/waves"]));
  });
  it("lists Approvals under Fix", () => {
    const fix = destinations().find((d) => d.id === "fix");
    expect(fix?.kids.some((k) => k.href === "/next/approvals")).toBe(true);
  });
  it("owns every Load address and maps each to a help chapter", () => {
    const all = destinations();
    for (const p of ["/load", "/load/compare", "/load/plan", "/load/s4", "/load/go-live", "/load/waves"]) {
      expect(destinationAt(p, all)?.id, p).toBe("load");
      expect(chapterFor(p), p).toBeTruthy();
    }
  });
});

const head = (id: string, run_number: number, run_at: string): VersionHead => ({ id, run_number, run_at, status: "complete", dqs_summary: { [FIXTURE_MODULE]: { composite_score: 77.4 } } }) as unknown as VersionHead;

describe("Source run picker", () => {
  it("names a run with number, date and DQS, never its id", () => {
    const label = runLabel(head("0a1b2c3d-uuid", 15, "2026-11-11T10:00:00Z"), FIXTURE_MODULE);
    expect(label).toMatch(/^Run 15, 11 Nov, DQS 77/);
    expect(label).not.toContain("uuid");
  });
  it("picks the highest run number as the newest", () => {
    expect(newestRun([head("a", 3, "2026-01-01"), head("b", 9, "2025-01-01"), head("c", 4, "2026-06-01")])?.id).toBe("b");
    expect(newestRun([])).toBeNull();
  });
  it("defaults to the newest finished run and reports a pick", async () => {
    const onChange = vi.fn();
    renderWithQuery(<SourceRunPicker system={FIXTURE_SYSTEM} module={FIXTURE_MODULE} label="Material" value={null} onChange={onChange} />);
    const select = (await screen.findByLabelText(/Source run for Material/)) as HTMLSelectElement;
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const first = select.options[0];
    expect(first.textContent).toMatch(/^Run \d+, .*DQS/);
    expect(onChange).toHaveBeenCalledWith(first.value);
    fireEvent.change(select, { target: { value: select.options[1].value } });
    expect(onChange).toHaveBeenLastCalledWith(select.options[1].value);
  });
});

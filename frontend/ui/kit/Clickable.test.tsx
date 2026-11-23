import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StatTile } from "./StatTile";
import { KpiStrip } from "./KpiStrip";
import { BarList } from "./BarList";
import { DimensionBars } from "./DimensionBars";
import { SeverityStrip } from "./SeverityStrip";

afterEach(cleanup);

describe("clickable kit tiles", () => {
  it("StatTile is a button only with onSelect", () => {
    const f = vi.fn();
    const { rerender } = render(<dl><StatTile label="Failing" value="3" /></dl>);
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<dl><StatTile label="Failing" value="3" onSelect={f} selected /></dl>);
    fireEvent.click(screen.getByRole("button", { name: "Failing" }));
    expect(f).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("true");
  });

  it("KpiStrip cell calls onSelect and carries a title", () => {
    const f = vi.fn();
    render(<KpiStrip label="K" cells={[{ label: "Score", value: "82", onSelect: f, title: "82.4 exact" }, { label: "Plain", value: "1" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Score" }));
    expect(f).toHaveBeenCalled();
    expect(document.querySelector("[title='82.4 exact']")).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("BarList and DimensionBars report the chosen id, and work with the keyboard", () => {
    const b = vi.fn(); const d = vi.fn();
    render(<><BarList label="B" items={[{ id: "a", label: "Alpha", value: 3 }, { id: "b", label: "Beta", value: 1 }]} onSelect={b} selected="b" />
      <DimensionBars naLabel="n/a" items={[{ key: "c", label: "Completeness", value: 90 }, { key: "t", label: "Timeliness", value: null }]} onSelect={d} /></>);
    fireEvent.click(screen.getByRole("button", { name: "Alpha" }));
    expect(b).toHaveBeenCalledWith("a");
    expect(screen.getByRole("button", { name: "Beta" }).getAttribute("aria-pressed")).toBe("true");
    const k = screen.getByRole("button", { name: "Completeness" });
    k.focus();
    expect(document.activeElement).toBe(k);
    fireEvent.click(k);
    expect(d).toHaveBeenCalledWith("c");
  });

  it("SeverityStrip filters by severity and tooltips value and share", () => {
    const f = vi.fn();
    render(<SeverityStrip rulesLabel={(n) => `${n} rules`} onSelect={f} selected="high" tiles={[{ sev: "critical", label: "Critical", rules: 1, records: "10" }, { sev: "high", label: "High", rules: 3, records: "20" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Critical" }));
    expect(f).toHaveBeenCalledWith("critical");
    expect(document.querySelector("[data-sev='high']")?.getAttribute("title")).toBe("High: 3 failing rules, 75% of all");
  });
});

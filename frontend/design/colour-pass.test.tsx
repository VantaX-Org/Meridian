import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { divInk, domainOf, rampStep, seqInk } from "./tokens";
import { Stat } from "./primitives/Stat";
import { Pill } from "./primitives/Pill";
import { Badge } from "./primitives/Badge";
import { Delta } from "./primitives/Delta";
import { DomainChip } from "./primitives/DomainChip";
import { Card } from "./primitives/Card";
import { DataTable, heatClass } from "./table/DataTable";
import { textColumn } from "./table/columns";
import type { ColumnDef } from "@tanstack/react-table";

describe("domainOf", () => {
  it.each([
    ["material_master", "material"], ["sd_customer", "customer"], ["vendor_master", "vendor"],
    ["business_partner", "partner"], ["fi_gl_account", "finance"], ["successfactors.employee", "people"],
    ["plant_maintenance", "plant"], ["fixed_asset", "asset"], ["unknown_thing", "other"],
    ["constructor", "other"], ["tostring", "other"], ["MM", "material"], ["SD", "customer"], ["FI", "finance"], ["CO", "finance"], ["HR", "people"], ["HCM", "people"], ["SF", "people"],
    ["PM", "asset"], ["EAM", "asset"], ["PP", "plant"], ["QM", "plant"], [null, "other"], [undefined, "other"],
  ])("%s -> %s", (id, key) => expect(domainOf(id)).toBe(key));
});

describe("ramp helpers", () => {
  it("steps quintiles and clamps", () => {
    expect(rampStep(0, 0, 100)).toBe(1);
    expect(rampStep(100, 0, 100)).toBe(5);
    expect(rampStep(50, 0, 100)).toBe(3);
    expect(rampStep(-5, 0, 100)).toBe(1);
    expect(rampStep(5, 5, 5)).toBe(1);
  });
  it("picks light ink on dark steps", () => {
    expect(seqInk(1)).toBe("var(--m-ink)");
    expect(seqInk(5)).toBe("var(--m-ink-on-accent)");
    expect(divInk(0)).toBe("var(--m-ink-on-accent)");
    expect(divInk(2)).toBe("var(--m-ink)");
  });
});

describe("primitives", () => {
  it("Stat shows a domain edge and hero mode", () => {
    const { container } = render(<Stat label="Records" value={5} domain="material" hero countUp={false} />);
    expect(container.querySelector(".m-stat-edge")).toBeInTheDocument();
    expect(container.querySelector(".m-stat-hero")).toBeInTheDocument();
  });
  it("Pill solid has no dot, soft verdict keeps one", () => {
    const { container, rerender } = render(<Pill tone="no-go" variant="solid">Fail</Pill>);
    expect(container.querySelector(".m-pill-solid-no-go")).toBeInTheDocument();
    expect(container.querySelector(".m-pill-dot")).toBeNull();
    rerender(<Pill tone="at-risk">Capped</Pill>);
    expect(container.querySelector(".m-pill-at-risk .m-pill-dot")).toBeInTheDocument();
  });
  it("Badge critical", () => {
    render(<Badge count={3} tone="critical" />);
    expect(screen.getByText("3")).toHaveClass("m-badge-critical");
  });
  it("Delta colours by good or bad, invert flips", () => {
    const { container, rerender } = render(<Delta value={2} />);
    expect(container.firstChild).toHaveClass("m-delta-up", "m-delta-good");
    rerender(<Delta value={2} invert />);
    expect(container.firstChild).toHaveClass("m-delta-up", "m-delta-bad");
    rerender(<Delta value={0} />);
    expect(container.firstChild).toHaveClass("m-delta-flat", "m-delta-zero");
  });
  it("DomainChip resolves a module id", () => {
    render(<DomainChip moduleId="vendor_master" />);
    expect(document.querySelector("[data-domain='vendor']")).toBeInTheDocument();
  });
  it("Card domain edge", () => {
    const { container } = render(<Card domain="plant">x</Card>);
    expect(container.querySelector("[data-domain='plant']")).toBeInTheDocument();
  });
});

describe("DataTable colour", () => {
  interface R { id: string; sev: string; n: number }
  const cols: ColumnDef<R>[] = [
    { accessorKey: "sev", header: "Severity", meta: { severity: true } },
    { accessorKey: "n", header: "Score", meta: { numeric: true, heat: "seq" } },
    textColumn<R>("id", "Id"),
  ];
  const data: R[] = [{ id: "a", sev: "critical", n: 0 }, { id: "b", sev: "pass", n: 100 }];
  it("adds a severity class per row and heat classes plus a legend strip", () => {
    const { container } = render(<DataTable columns={cols} data={data} getRowId={(r) => r.id} />);
    expect(container.querySelector(".m-row-severity-critical")).toBeInTheDocument();
    expect(container.querySelector(".m-row-severity-pass")).toBeInTheDocument();
    expect(container.querySelector(".m-heat-seq-1")).toBeInTheDocument();
    expect(container.querySelector(".m-heat-seq-5")).toBeInTheDocument();
    expect(container.querySelector(".m-legend-strip-seq")).toBeInTheDocument();
  });
  it("heatClass maps div steps and ignores non-numbers", () => {
    expect(heatClass("div", -1, [-1, 1])).toBe("m-heat-div-neg-2");
    expect(heatClass("div", 1, [-1, 1])).toBe("m-heat-div-pos-2");
    expect(heatClass("seq", "x", [0, 1])).toBeUndefined();
  });
});

describe("Counter settle", () => {
  it("drops m-count-settle after one settle period", async () => {
    const { Counter } = await import("./primitives/Counter");
    const { act } = await import("@testing-library/react");
    const { vi } = await import("vitest");
    vi.useFakeTimers();
    const { container } = render(<Counter value={5} versionId="v1" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    expect(container.querySelector(".m-count-settle")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(container.querySelector(".m-count-settle")).not.toBeInTheDocument();
    vi.useRealTimers();
  });
});

describe("Graph cluster colour and Pareto domain colour", () => {
  it("fills a clustered node from the viz palette, domain otherwise", async () => {
    const { Graph } = await import("./charts/Graph");
    const { mColor } = await import("./tokens");
    const { container } = render(
      <Graph nodes={[{ id: "a", size: 1, label: "A", cluster: 2, domain: "plant" }, { id: "b", size: 1, label: "B", domain: "plant" }]} edges={[]} masterId="none" />,
    );
    expect(container.querySelector("[data-cluster='2'] circle")?.getAttribute("fill")).toBe(mColor.viz[2]);
    expect(container.querySelector("[data-domain='plant']:not([data-cluster]) circle")?.getAttribute("fill")).toBe(mColor.dom.plant);
  });
  it("colours Pareto bars through the domain palette", async () => {
    const { chartTheme } = await import("./charts/theme");
    const { mColor } = await import("./tokens");
    expect(chartTheme.domain("vendor")).toBe(mColor.dom.vendor);
  });
});

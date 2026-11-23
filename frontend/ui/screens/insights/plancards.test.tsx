import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import { MdmSeriesCard, QueueCards } from "./MonitorSeries";
import { PlanCard } from "./PlanCards";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => { undo = stubLayout(); window.sessionStorage.clear(); window.history.replaceState(null, "", "/insights/forecast?fixture=1"); });
afterEach(() => undo());

const dot = String.fromCharCode(0xb7);

describe("remediation plan in fixture mode", () => {
  it("ranks the open work, cuts it into sprints and prices one finding", async () => {
    const { container } = renderWithQuery(<PlanCard />);
    expect(await screen.findByText("Remediation plan", undefined, { timeout: 5000 })).toBeTruthy();
    expect((await screen.findAllByText("Planned delivery time missing on purchased parts", undefined, { timeout: 5000 })).length).toBeGreaterThan(0);
    expect(screen.getByRole("table", { name: "Ranked actions" })).toBeTruthy();
    expect(await screen.findByRole("table", { name: "Sprint plan" }, { timeout: 5000 })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show cost of Duplicate vendor bank details" }));
    expect(await screen.findByRole("table", { name: "Finding cost calculation" }, { timeout: 5000 })).toBeTruthy();
    expect(screen.getAllByText("duplicate_payment").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("table", { name: "Finding cost calculation" })).toBeNull();
    expect(container.textContent ?? "").not.toContain(dot);
  });
});

describe("monitor queue and master data series in fixture mode", () => {
  it("shows the stuck stage, the capacity gap and the health series", async () => {
    const { container } = renderWithQuery(<><QueueCards /><MdmSeriesCard /></>);
    expect(await screen.findByRole("table", { name: "Queue bottlenecks" }, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByText("recommended")).toBeTruthy();
    expect(await screen.findByText("Steward capacity", undefined, { timeout: 5000 })).toBeTruthy();
    expect(await screen.findByText("Stewards needed", undefined, { timeout: 5000 })).toBeTruthy();
    expect(await screen.findByText("Master data health over time", undefined, { timeout: 5000 })).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText("Health score").length).toBeGreaterThan(0), { timeout: 5000 });
    expect(container.textContent ?? "").not.toContain(dot);
  });
});

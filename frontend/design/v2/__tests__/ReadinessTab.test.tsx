import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as objectApi from "@/lib/api/v2/object";
import { ReadinessTab } from "../screens/object/ReadinessTab";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  setUrl("/o/ecc-production/material-master/readiness?fixture=1");
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const norm = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
const cells = (row: HTMLElement) => Array.from(row.querySelectorAll("th,td")).map((c) => norm(c as HTMLElement));
const render = (module = "material-master") => renderWithQuery(<ReadinessTab system="ecc-production" module={module} />);

describe("wave membership and verdict", () => {
  it("lists every wave the object is in with its verdict, blocking gaps, score, readiness and blocked records", async () => {
    render();
    const t = await screen.findByRole("table", { name: "Waves that include Material master" });
    const rows = within(t).getAllByRole("row").slice(1).map(cells);
    expect(rows).toEqual([
      ["Wave 1", "No-go", "2", "70.0", "62.4", "6,544"],
      ["Wave 2", "No-go", "5", "70.0", "62.4", "6,544"],
    ]);
    expect(screen.getByText("Gate: min score 75.0")).toBeInTheDocument();
  });

  it("draws the verdict mark beside the word, never the word alone", async () => {
    render();
    const t = await screen.findByRole("table", { name: /Waves that include/ });
    const cell = within(t).getAllByRole("row")[1].querySelectorAll("td")[0];
    expect(cell.querySelector("svg.m2-vm")).not.toBeNull();
  });

  it("says when the object is in no wave, with the one action", async () => {
    vi.spyOn(objectApi, "getReadiness").mockResolvedValue({ threshold: 75, cells: [], configured: true });
    render();
    expect(await screen.findByText(/Material master is not in a migration wave yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open migration waves" })).toHaveAttribute("href", expect.stringContaining("open=waves"));
  });

  it("reads another object's own waves", async () => {
    render("mm_purchasing");
    const t = await screen.findByRole("table", { name: "Waves that include MM purchasing" });
    // No readiness score for it: the two unmeasured columns are hidden, with the reason.
    expect(within(t).getAllByRole("row").slice(1).map(cells)).toEqual([["Wave 2", "No-go", "2", "70.0"]]);
    expect(screen.getByTestId("readiness-unscored")).toHaveTextContent("Readiness and records blocked are not shown");
  });
});

describe("the cap rule", () => {
  it("states what holds the score, names the capping rules as links, and quotes the cap rule", async () => {
    render();
    const s = await screen.findByTestId("cap-statement");
    expect(norm(s)).toBe("Held at 70 by MM003 and MM035, two critical rules over tolerance. Measured 71.8, shown 70.0. Cap rule: 85 at one critical rule over tolerance, 70 at two or more.");
    expect(within(s).getByRole("link", { name: "MM003" })).toHaveAttribute("href", expect.stringContaining("open=rule%3AMM003"));
    expect(within(s).getByRole("link", { name: "MM035" })).toHaveAttribute("href", expect.stringContaining("open=rule%3AMM035"));
  });
});

describe("blocked and degraded features", () => {
  it("lists the blocked features with the rules of this object behind each, as links", async () => {
    render();
    const h = await screen.findByRole("heading", { name: /Blocked in S\/4HANA/ });
    const list = h.parentElement?.querySelector("ul") as HTMLElement;
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(3));
    const items = within(list).getAllByRole("listitem");
    expect(norm(items[0])).toBe("Migration cockpit: material loadMM142, MM003");
    expect(within(items[0]).getByRole("link", { name: "Migration cockpit: material load" })).toHaveAttribute("href", expect.stringContaining("open=feature%3A"));
    expect(within(items[0]).getByRole("link", { name: "MM003" })).toHaveAttribute("href", expect.stringContaining("open=rule%3AMM003"));
    expect(norm(items[1])).toBe("Material ledger actual costingMM142");
    expect(norm(h)).toContain("3");
  });

  it("lists the degraded features the same way", async () => {
    render();
    const h = await screen.findByRole("heading", { name: /Degraded in S\/4HANA/ });
    const list = h.parentElement?.querySelector("ul") as HTMLElement;
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(5));
    expect(within(list).getAllByRole("listitem").map(norm)).toEqual([
      "MRP LiveMM023",
      "Advanced available-to-promiseMM015",
      "Source of supply determinationMM302",
      "Product complianceMM007",
      "Inventory valuation by plantMM035",
    ]);
  });

  it("says so when no feature is touched by this object's rules", async () => {
    render("mm_purchasing");
    expect(await screen.findByText("No S/4 feature is blocked by a rule of this object.")).toBeInTheDocument();
    expect(screen.getByText("No S/4 feature is degraded by a rule of this object.")).toBeInTheDocument();
  });

  it("a failed read of the impact is an error with Retry", async () => {
    vi.spyOn(objectApi, "getConfigImpact").mockRejectedValue(new Error("down"));
    render();
    const alert = await screen.findByText("The feature impact could not be read for this run.");
    expect(alert.closest("[data-testid='error-frame']")?.querySelector("button")).toHaveTextContent("Retry");
  });
});

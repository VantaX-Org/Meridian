import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as lineage from "@/lib/api/v2/lineage";
import { BlastRadius } from "../screens/BlastRadius";
import { stubLayout } from "./layout-stub";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const norm = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ").trim();

describe("blast radius", () => {
  it("totals the documents in flight and lights one field's path through steps, features and KPIs", async () => {
    renderWithQuery(<BlastRadius checkId="MM302" versionId="v-1" failing={120} fixHref="/r/MM302?tab=failing" />);
    const root = await screen.findByTestId("blast-radius");
    expect(norm(await within(root).findByText("Documents in flight").then((d) => d.parentElement as HTMLElement))).toContain("5,126");
    expect(within(root).getByRole("link", { name: "Fix the 120 failing records" }).getAttribute("href")).toMatch(/^\/r\/MM302\?tab=failing/);

    const steps = within(root).getByRole("region", { name: "Process steps" });
    expect(within(steps).getAllByRole("button").length).toBe(14);

    const field = within(within(root).getByRole("region", { name: "Fields read" })).getAllByRole("button")[0];
    fireEvent.click(field);
    expect(field).toHaveAttribute("aria-pressed", "true");
    const lit = root.querySelectorAll('[data-node][data-on="true"]');
    const dim = root.querySelectorAll('[data-node][data-on="false"]');
    expect(lit.length).toBeGreaterThan(1);
    expect(lit.length + dim.length).toBe(root.querySelectorAll("[data-node]").length);
    fireEvent.click(field);
    expect(root.querySelectorAll('[data-node][data-on]').length).toBe(0);
  });

  it("shows a dash, not zero, for documents before the rule has a run", async () => {
    renderWithQuery(<BlastRadius checkId="MM302" versionId={null} failing={0} fixHref="/r/MM302?tab=failing" />);
    const root = await screen.findByTestId("blast-radius");
    const docs = within(root).getByText("Documents in flight").parentElement as HTMLElement;
    expect(norm(docs)).toBe("Documents in flight—");
    expect(within(root).queryByRole("link", { name: /Fix the/ })).toBeNull();
  });

  it("says so when the lineage cannot be read", async () => {
    vi.spyOn(lineage, "getRuleLineage").mockRejectedValue(new Error("404"));
    renderWithQuery(<BlastRadius checkId="ZZ999" versionId="v-1" failing={3} fixHref="/r/ZZ999?tab=failing" />);
    expect(await screen.findByText(/lineage of this rule could not be read/)).toBeInTheDocument();
  });
});

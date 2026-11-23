import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import { AletheiaProvider } from "@/ui/kit";
import { People } from "./People";
import { Stewardship } from "./Stewardship";
import { Contracts } from "./Contracts";
import { Digests } from "./Digests";
import { Assignments } from "./Assignments";
import { Share } from "./Share";
import { listStewardQueue } from "@/lib/api/v2/stewardship";
import { resetStewardFixture } from "@/lib/api/v2/fixtures/stewardship";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  undo = stubLayout();
  window.sessionStorage.clear();
  resetStewardFixture();
  window.history.replaceState(null, "", "/people?fixture=1");
});
afterEach(() => undo());

const wrap = (el: ReactElement) => <AletheiaProvider>{el}</AletheiaProvider>;
const cases: [string, ReactElement, string][] = [
  ["People", <People key="p" />, "People"],
  ["Stewardship", <Stewardship key="s" />, "Stewardship"],
  ["Contracts", <Contracts key="c" />, "Data contracts"],
  ["Digests", <Digests key="d" />, "Digests"],
  ["Assignments", <Assignments key="a" />, "Assignments"],
];

describe("people and governance screens in fixture mode", () => {
  it.each(cases)("%s shows its title and real rows", async (_n, el, title) => {
    renderWithQuery(wrap(el));
    expect(await screen.findByRole("heading", { level: 1, name: title })).toBeTruthy();
    expect((await screen.findAllByRole("row")).length).toBeGreaterThan(1);
  });

  it("Share resolves a link and offers the shared page", async () => {
    renderWithQuery(wrap(<Share token="demo" />));
    expect(await screen.findByRole("heading", { level: 1, name: "Shared with you" })).toBeTruthy();
    expect(await screen.findByRole("link", { name: "Open the shared page" })).toBeTruthy();
  });

  it("Stewardship queue lists open items and approves the confident ones together", async () => {
    renderWithQuery(wrap(<Stewardship />));
    expect(await screen.findByText("Material group is blank")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Approve 3 confident items" }));
    await waitFor(() => expect(screen.queryByText("Material group is blank")).toBeNull());
  });

  it("Stewardship queue shows the lifecycle for a selected item and escalates it", async () => {
    renderWithQuery(wrap(<Stewardship />));
    fireEvent.click(await screen.findByText("Payment terms are blank"));
    expect(await screen.findByRole("list", { name: "Where the item stands" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Escalate" }));
    await waitFor(() => expect(screen.queryByRole("list", { name: "Where the item stands" })).toBeNull());
  });
  it("Stewardship queue assigns an item to a chosen person and releases it", async () => {
    renderWithQuery(wrap(<Stewardship />));
    fireEvent.click(await screen.findByText("Payment terms are blank"));
    const pick = (await screen.findByLabelText(/^Owner/)) as HTMLSelectElement;
    await waitFor(() => expect(pick.options.length).toBeGreaterThan(2));
    fireEvent.change(pick, { target: { value: "u-rg" } });
    fireEvent.click(screen.getByRole("button", { name: "Save owner" }));
    await waitFor(async () => {
      const q = await listStewardQueue({ status: "in_progress" });
      expect(q.items.find((x) => x.id === "sq-04")?.assigned_to).toBe("u-rg");
    });
  });
});

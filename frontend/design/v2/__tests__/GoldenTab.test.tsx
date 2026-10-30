import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as mdm from "@/lib/api/v2/mdm";
import { resetMdmFixture } from "@/lib/api/v2/fixtures/mdm";
import { Inspector } from "../Inspector";
import { GoldenTab } from "../screens/object/GoldenTab";
import { overridesOf } from "../inspector/golden";
import { setUrl } from "./nav-store";
import { stubLayout } from "./layout-stub";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

let granted: string[] | "all" = "all";
vi.mock("@/lib/v2/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/v2/hooks")>();
  return {
    ...actual,
    useV2Session: () => ({ persona: "lead" as const, label: "Programme lead", name: "Test", email: null, fixture: true, can: (a: string) => granted === "all" || granted.includes(a) }),
  };
});

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  window.localStorage.clear();
  granted = "all";
  resetMdmFixture();
  undo = stubLayout();
  setUrl("/o/ecc-production/material-master/golden?fixture=1");
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const norm = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
const tab = (module = "material-master") => renderWithQuery(<GoldenTab system="ecc-production" module={module} />);

describe("the Golden records tab", () => {
  it("lists the golden records in a grid: key, name, sources, survivorship rule, confidence, last merged, open conflicts", async () => {
    tab();
    const grid = await screen.findByRole("grid", { name: "Golden records of Material master" });
    expect(within(grid).getAllByRole("columnheader").map((h) => norm(h))).toEqual(["Golden key", "Name", "Sources", "Survivorship", "Confidence", "Last merged", "Open conflicts"]);
    await waitFor(() => expect(within(grid).getAllByRole("row").length).toBeGreaterThan(5));
    const first = within(grid).getAllByRole("row")[1];
    const cells = within(first).getAllByRole("gridcell").map((c) => norm(c));
    expect(cells[0]).toBe("MATNR=000000000000000101");
    expect(cells[1]).toBe("Hex bolt M8 zinc");
    expect(cells[2]).toBe("2");
    expect(cells[3]).toBe("Trusted source, 2 more");
    expect(cells[4]).toMatch(/^\d+%$/);
    expect(cells[5]).toMatch(/2026/);
    expect(cells[6]).toBe("1"); // record 0 has one open conflict
    expect(screen.getByText("1,284 records")).toBeInTheDocument();
    expect(screen.getByText("1 to 25 of 1,284")).toBeInTheDocument();
  });

  it("opens a golden record in the inspector from a row", async () => {
    tab();
    const grid = await screen.findByRole("grid", { name: "Golden records of Material master" });
    await waitFor(() => expect(within(grid).getAllByRole("row").length).toBeGreaterThan(2));
    fireEvent.click(within(grid).getAllByRole("row")[1]);
    const { getUrl } = await import("./nav-store");
    expect(getUrl()).toContain("open=golden%3Agr-0");
  });

  it("says N pairs to review, lists the best pairs with a Review link into the inspector", async () => {
    tab();
    expect(await screen.findByText("148 pairs to review")).toBeInTheDocument();
    const list = await screen.findByRole("list", { name: "Pairs to review" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(5);
    const review = within(list).getAllByRole("link", { name: /^Review the pair/ })[0];
    expect(review).toHaveAttribute("href", expect.stringContaining("open=golden%3Apair%3Ams-0"));
    expect(screen.getByText(/Showing the first 5 of 148, best score first/)).toBeInTheDocument();
  });

  it("summarises the survivorship rules and opens the editor from the inspector", async () => {
    tab();
    const sec = await screen.findByRole("region", { name: "Survivorship rules" });
    const list = await within(sec).findByRole("list", { name: "Survivorship rules by field" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(5);
    expect(norm(within(list).getAllByRole("listitem")[1])).toBe("MARA-MEINSTrusted source, ECC production");
    expect(within(sec).getByRole("link", { name: "Edit the rules" })).toHaveAttribute("href", expect.stringContaining("open=survivorship%3Amaterial_master"));
  });

  it("is a designed empty state, with what would put rows here, for an object without golden records", async () => {
    tab("purchasing");
    const empty = await screen.findByTestId("empty-frame");
    expect(empty).toHaveTextContent(/No golden records for Purchasing yet\. A match run groups the records that describe the same thing/);
    expect(within(empty).queryByRole("link")).toBeNull();
  });

  it("shows a dash for the name when the list does not carry one", async () => {
    vi.spyOn(mdm, "getGoldenRecords").mockResolvedValue({
      records: [{ id: "g1", domain: "material_master", sap_object_key: "MATNR=1", overall_confidence: 0.9, status: "golden", source_count: 2, pending_issues: 0, promoted_at: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-02T00:00:00Z" }],
      total: 1,
      page: 1,
      per_page: 25,
    });
    tab();
    const grid = await screen.findByRole("grid", { name: "Golden records of Material master" });
    const row = await waitFor(() => within(grid).getAllByRole("row")[1]);
    expect(norm(within(row).getAllByRole("gridcell")[1])).toBe("—");
    expect(norm(within(row).getAllByRole("gridcell")[6])).toBe("0");
  });
});

describe("the golden record inspector", () => {
  const open = async (id = "gr-3") => {
    setUrl(`/o/ecc-production/material-master/golden?open=golden:${id}&fixture=1`);
    renderWithQuery(<Inspector />);
    const d = await screen.findByRole("dialog");
    await within(d).findByRole("table", { name: /Golden fields/ });
    await within(d).findByRole("list", { name: "Source records" });
    return d;
  };

  it("draws facts, fields, source records, actions and history, named by the golden key", async () => {
    const d = await open();
    expect(d).toHaveAccessibleName("MATNR=000000000000000104");
    expect(within(d).getAllByRole("region").map((r) => r.getAttribute("aria-label"))).toEqual(["Facts", "Fields", "Source records", "Actions", "History"]);
    const fields = within(d).getByRole("table", { name: /Golden fields/ });
    const rows = within(fields).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(6);
    expect(norm(rows[2])).toContain("MARA-MEINS");
    expect(norm(rows[2])).toContain("Trusted source");
    expect(norm(rows[2])).toContain("Differs: PCS (Legacy plant extract)");
    expect(within(d).getAllByRole("listitem").some((li) => norm(li) === "MATNR=104Survivor")).toBe(true);
  });

  it("splits selected records out with a reason, by permission", async () => {
    const split = vi.spyOn(mdm, "splitGolden");
    const d = await open();
    const box = within(d).getByRole("checkbox", { name: /Split out MATNR=000000000000020003/ });
    const go = within(d).getByRole("button", { name: "Choose records to split out" });
    expect(go).toBeDisabled();
    fireEvent.click(box);
    const btn = within(d).getByRole("button", { name: "Split out 1 record" });
    expect(btn).toBeDisabled(); // no reason yet
    fireEvent.change(within(d).getByLabelText("Reason for the split"), { target: { value: "Different pack size" } });
    fireEvent.click(btn);
    expect(await within(d).findByTestId("action-result")).toHaveTextContent(/1 record split out/);
    expect(split).toHaveBeenCalledWith("gr-3", ["MATNR=000000000000020003"], "Different pack size");
  });

  it("without the approve permission there is no split control", async () => {
    granted = [];
    const d = await open();
    expect(within(d).queryByRole("checkbox")).toBeNull();
    expect(within(d).queryByRole("button", { name: /Split/ })).toBeNull();
    expect(within(d).getByText(/Splitting a golden record needs the approve permission/)).toBeInTheDocument();
    expect(within(d).queryByRole("link", { name: /current interface/ })).toBeNull();
  });
});

describe("the pair inspector", () => {
  const open = async (id = "ms-0") => {
    setUrl(`/o/ecc-production/material-master/golden?open=golden:pair:${id}&fixture=1`);
    renderWithQuery(<Inspector />);
    const d = await screen.findByRole("dialog");
    await within(d).findByRole("table", { name: /side by side/ });
    return d;
  };

  it("shows the two records side by side with a pick per field that differs", async () => {
    const d = await open();
    expect(d).toHaveAccessibleName("Possible duplicate");
    expect(within(d).getAllByRole("region").map((r) => r.getAttribute("aria-label"))).toEqual(["Facts", "Side by side", "Actions"]);
    const t = within(d).getByRole("table", { name: /side by side/ });
    const rows = within(t).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(6);
    expect(within(t).getAllByRole("radio")).toHaveLength(8); // four fields differ, two radios each
    expect(norm(rows[2])).toContain("ROH (same)");
    expect(within(d).getByText("Match score")).toBeInTheDocument();
  });

  it("merges with the survivor's key and the picked values as overrides", async () => {
    const merge = vi.spyOn(mdm, "mergePair");
    const d = await open();
    fireEvent.click(within(d).getByRole("radio", { name: "MAKT-MAKTX: keep the value of record B" }));
    const btn = within(d).getByRole("button", { name: "Merge" });
    expect(btn).toBeDisabled();
    fireEvent.change(within(d).getByLabelText("Reason"), { target: { value: "Same bolt" } });
    fireEvent.click(btn);
    expect(await within(d).findByTestId("action-result")).toHaveTextContent("Merged");
    expect(merge).toHaveBeenCalledWith("ms-0", { survivor: "MATNR=000000000000005000", overrides: { "MAKT-MAKTX": "Hex bolt M8 zinc zinc plated" }, reason: "Same bolt" });
    expect(within(d).queryByRole("button", { name: "Merge" })).toBeNull();
  });

  it("marks a pair as not a duplicate with a reason", async () => {
    const reject = vi.spyOn(mdm, "markNotDuplicate");
    const d = await open();
    fireEvent.change(within(d).getByLabelText("Reason"), { target: { value: "Different thread" } });
    fireEvent.click(within(d).getByRole("button", { name: "Not a duplicate" }));
    expect(await within(d).findByTestId("action-result")).toHaveTextContent("Marked as not a duplicate");
    expect(reject).toHaveBeenCalledWith("ms-0", "Different thread");
  });

  it("without the approve permission the pair is read-only: no radios, no merge, no not-a-duplicate", async () => {
    granted = [];
    const d = await open();
    expect(within(d).queryByRole("radio")).toBeNull();
    expect(within(d).queryByRole("button", { name: "Merge" })).toBeNull();
    expect(within(d).queryByRole("button", { name: "Not a duplicate" })).toBeNull();
    expect(within(d).getByText(/needs the approve permission/)).toBeInTheDocument();
  });
});

describe("overridesOf", () => {
  const detail = {
    record_a: { key: "A", record_id: null, confidence: null, fields: { x: "1", y: "same", z: "a" } },
    record_b: { key: "B", record_id: null, confidence: null, fields: { x: "2", y: "same", z: "b" } },
  } as unknown as mdm.ReviewPairDetail;
  it("keeps only the fields where the pick is the other record's value", () => {
    expect(overridesOf(detail, "a", {})).toEqual({});
    expect(overridesOf(detail, "a", { x: "b", y: "b" })).toEqual({ x: "2" });
    expect(overridesOf(detail, "b", { z: "a" })).toEqual({ z: "a" });
  });
});

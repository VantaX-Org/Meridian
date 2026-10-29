import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as objectApi from "@/lib/api/v2/object";
import * as landscapeApi from "@/lib/api/v2/landscape";
import { resetObjectFixture } from "@/lib/api/v2/fixtures/object";
import { resetWorkFixture } from "@/lib/api/v2/fixtures";
import { RulesTab } from "../screens/object/RulesTab";
import { getUrl, setUrl } from "./nav-store";

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

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  granted = "all";
  resetObjectFixture();
  resetWorkFixture();
  setUrl("/v2/o/ecc-production/material-master?fixture=1");
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const norm = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
/** The text of each cell of a row, so adjacent cells are not run together. */
const cellsOf = (row: HTMLElement) => Array.from(row.querySelectorAll("th,td")).map((c) => norm(c as HTMLElement));
const render = () => renderWithQuery(<RulesTab system="ecc-production" module="material-master" />);
const grid = () => screen.findByRole("grid", { name: "Rules for Material master" });
/** The data rows of the ranked table: everything between the header and the two footer rows. */
const dataRows = (g: HTMLElement) => within(g).getAllByRole("row").slice(1, -2);

describe("ranking", () => {
  it("ranks the object's rules by value at risk, largest first", async () => {
    render();
    const g = await grid();
    await waitFor(() => expect(dataRows(g)).toHaveLength(8));
    expect(dataRows(g).map((r) => within(r).getAllByRole("link")[0].textContent)).toEqual(["MM014", "MM031", "MM022", "MM057", "MM063", "MM078", "MM091", "MM105"]);
  });

  it("puts unpriced rules after priced ones, then ranks by failing records", async () => {
    const rows = [
      { check_id: "A1", name: "a", field: null, severity: "low" as const, affected_count: 900, total_count: 1000, pass_rate: 10, value_at_risk: null },
      { check_id: "B2", name: "b", field: null, severity: "low" as const, affected_count: 10, total_count: 1000, pass_rate: 99, value_at_risk: 5 },
      { check_id: "C3", name: "c", field: null, severity: "low" as const, affected_count: 500, total_count: 1000, pass_rate: 50, value_at_risk: null },
    ];
    vi.spyOn(landscapeApi, "getObjectRules").mockResolvedValue(rows);
    render();
    const g = await grid();
    await waitFor(() => expect(dataRows(g)).toHaveLength(3));
    expect(dataRows(g).map((r) => within(r).getAllByRole("link")[0].textContent)).toEqual(["B2", "A1", "C3"]);
  });

  it("shows each rule with its id, name, why it matters and the suggested values line", async () => {
    render();
    const g = await grid();
    await waitFor(() => expect(dataRows(g)).toHaveLength(8));
    const first = norm(dataRows(g)[0]);
    expect(first).toContain("MM014 Base unit of measure not valid");
    expect(first).toContain("Goods movements and MRP cannot post for a material whose base unit is not an ISO unit.");
    await waitFor(() => expect(norm(dataRows(g)[0])).toContain("112 suggested values"));
    expect(norm(dataRows(g)[0])).toContain("Accept all");
    expect(norm(dataRows(g)[1])).not.toContain("suggested values"); // MM031 has none
  });

  it("fills field, dimension, severity, tolerance, over tolerance, failing rows, failing %, coverage and value at risk", async () => {
    render();
    const g = await grid();
    await waitFor(() => expect(dataRows(g)).toHaveLength(8));
    await waitFor(() => expect(within(dataRows(g)[0]).getAllByRole("gridcell")[5]).toHaveTextContent("Yes"));
    const cells = within(dataRows(g)[0]).getAllByRole("gridcell").map(norm);
    expect(cells[1]).toBe("Base unit of measureMARA.MEINS");
    expect(cells[2]).toBe("Validity");
    expect(cells[3]).toBe("Critical");
    expect(cells[4]).toBe("25 rows");
    expect(cells[5]).toBe("Yes");
    expect(cells[6]).toBe("3,640");
    expect(cells[7]).toBe("5.89%");
    expect(cells[8]).toBe("100.0%");
    expect(cells[9]).toBe("1,184,000");
    // A high rule has no tolerance of its own and is not over tolerance.
    const high = within(dataRows(g)[2]).getAllByRole("gridcell").map(norm);
    expect(high[3]).toBe("High");
    expect(high[4]).toBe("—");
    expect(high[5]).toBe("No");
  });

  it("closes with 'and N more rules' and the totals", async () => {
    render();
    const g = await grid();
    await waitFor(() => expect(dataRows(g)).toHaveLength(8));
    const rows = within(g).getAllByRole("row");
    await waitFor(() => expect(norm(rows[rows.length - 2])).toContain("and 905 more rules"));
    expect(norm(rows[rows.length - 2])).toContain("56,000"); // 4,200,000 less the 4,144,000 shown
    expect(norm(rows[rows.length - 1])).toContain("All 913 rules");
    expect(norm(rows[rows.length - 1])).toContain("4,200,000");
  });

  it("has an i on the tolerance, over tolerance, failing %, coverage and value at risk headers", async () => {
    render();
    const g = await grid();
    for (const name of ["Tolerance", "Over tolerance", "Failing %", "Coverage", "Value at risk"]) {
      expect(within(g).getByRole("button", { name: `About ${name}` })).toBeInTheDocument();
    }
  });

  it("opens a rule in the inspector from the id and from the row", async () => {
    render();
    const g = await grid();
    await waitFor(() => expect(dataRows(g)).toHaveLength(8));
    expect(within(dataRows(g)[0]).getByRole("link", { name: "MM014" })).toHaveAttribute("href", expect.stringContaining("open=rule%3AMM014"));
    fireEvent.click(dataRows(g)[1]);
    expect(getUrl()).toContain("open=rule%3AMM031");
  });

  it("says so when no rule has failed, and offers Retry when the read fails", async () => {
    const spy = vi.spyOn(landscapeApi, "getObjectRules").mockResolvedValue([]);
    const { unmount } = render();
    expect(await screen.findByText(/No rule has failed for Material master in this run/)).toBeInTheDocument();
    unmount();
    spy.mockRejectedValue(new Error("down"));
    render();
    const alert = await screen.findByTestId("error-frame");
    expect(alert).toHaveTextContent("The rules could not be read for this object.");
    expect(within(alert).getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("shows 25 rules and adds 25 on request", async () => {
    window.history.pushState({}, "", "/v2/o/ecc-production/material-master?fixture=1&rows=60");
    render();
    const g = await grid();
    await waitFor(() => expect(dataRows(g)).toHaveLength(25));
    fireEvent.click(within(g).getByRole("button", { name: "Show 25 more" }));
    expect(dataRows(g)).toHaveLength(50);
    window.history.pushState({}, "", "/");
  });
});

describe("pivot", () => {
  it("groups by dimension with the rules, failing rows and value at risk of each", async () => {
    render();
    await grid();
    fireEvent.click(screen.getByRole("button", { name: "By dimension" }));
    const t = await screen.findByRole("table", { name: /by dimension/i });
    const rows = within(t).getAllByRole("row").slice(1);
    // Largest value at risk first: Completeness carries five of the high rules and MM031.
    expect(rows.map(cellsOf)).toEqual([
      ["Completeness", "6", "13,680", "2,692,000"],
      ["Validity", "1", "3,640", "1,184,000"],
      ["Consistency", "1", "1,894", "268,000"],
    ]);
  });

  it("groups by severity in severity order", async () => {
    render();
    await grid();
    fireEvent.click(screen.getByRole("button", { name: "By severity" }));
    const t = await screen.findByRole("table", { name: /by severity/i });
    expect(within(t).getAllByRole("row").slice(1).map(cellsOf)).toEqual([
      ["Critical", "2", "6,544", "2,086,000"],
      ["High", "6", "12,670", "2,058,000"],
    ]);
  });

  it("groups by field and expands a group to its rules, each a link", async () => {
    render();
    await grid();
    fireEvent.click(screen.getByRole("button", { name: "By field" }));
    const t = await screen.findByRole("table", { name: /by field/i });
    const row = within(t).getAllByRole("row")[1];
    expect(norm(row)).toContain("MARA.MEINS");
    fireEvent.click(within(row).getByRole("button"));
    expect(within(t).getByRole("link", { name: "MM014" })).toHaveAttribute("href", expect.stringContaining("open=rule%3AMM014"));
  });

  it("groups by S/4 feature from the impact model, counting a rule under each feature it touches", async () => {
    render();
    await grid();
    fireEvent.click(screen.getByRole("button", { name: "By S/4 feature" }));
    const t = await screen.findByRole("table", { name: /by s\/4 feature/i });
    await waitFor(() => expect(within(t).getAllByRole("row").length).toBeGreaterThan(3));
    const rows = within(t).getAllByRole("row").slice(1).map(cellsOf);
    expect(rows.find((r) => r[0].startsWith("Migration cockpit: material load"))).toEqual(["Migration cockpit: material loadBlocked", "2", "6,544", "2,086,000"]);
    expect(rows.find((r) => r[0].startsWith("MRP Live"))).toEqual(["MRP LiveDegraded", "1", "1,894", "268,000"]);
    expect(rows[rows.length - 1][0]).toBe("No S/4 feature"); // MM105 maps to no feature, and unmapped groups come last
    expect(screen.getByText(/counted under each/)).toBeInTheDocument();
  });

  it("goes back to the ranked rules with By rule", async () => {
    render();
    await grid();
    fireEvent.click(screen.getByRole("button", { name: "By field" }));
    await screen.findByRole("table", { name: /by field/i });
    fireEvent.click(screen.getByRole("button", { name: "By rule" }));
    expect(await grid()).toBeInTheDocument();
  });
});

describe("accept all", () => {
  it("calls the accept-all endpoint for the rule on the object's run, then says where the values went", async () => {
    const spy = vi.spyOn(objectApi, "acceptAllSuggested").mockResolvedValue({ accepted: 112, draft_batch_id: "B-243" });
    render();
    const g = await grid();
    const btn = await within(g).findByRole("button", { name: "Accept all 112 suggested values for MM014" });
    fireEvent.click(btn);
    await waitFor(() => expect(spy).toHaveBeenCalledWith("MM014", "d3229ded-0708-4967-9dfb-1b7f4fada953"));
    expect(await screen.findByTestId("rules-note")).toHaveTextContent("112 suggested values for MM014 are in your draft batch B-243");
    await waitFor(() => expect(norm(dataRows(g)[0])).toContain("Suggested values accepted"));
  });

  it("offers View instead of Accept all to a role that cannot apply fixes", async () => {
    granted = ["view"];
    render();
    const g = await grid();
    await waitFor(() => expect(norm(dataRows(g)[0])).toContain("112 suggested values"));
    expect(within(g).queryByRole("button", { name: /Accept all/ })).toBeNull();
    expect(within(dataRows(g)[0]).getByRole("link", { name: "View" })).toHaveAttribute("href", expect.stringContaining("/v2/work?rule=MM014"));
  });
});

describe("Learned and Drafts", () => {
  it("lists the learned rules waiting, and lets an approver approve with a severity and reject", async () => {
    const approve = vi.spyOn(objectApi, "approveLearned").mockResolvedValue({ id: "lp-001", status: "approved", rule_id: "LR-000007" });
    render();
    const chip = await screen.findByRole("button", { name: "Learned 2" });
    fireEvent.click(chip);
    const t = await screen.findByRole("table", { name: "Learned rules waiting for a decision" });
    expect(norm(within(t).getAllByRole("row")[1])).toContain("Decided by another field");
    expect(norm(within(t).getAllByRole("row")[1])).toContain("MARC.DISMM by MARA.MTART");
    expect(norm(within(t).getAllByRole("row")[1])).toContain("97%");
    fireEvent.change(within(t).getByRole("combobox", { name: "Severity for MARC.DISMM" }), { target: { value: "high" } });
    fireEvent.click(within(within(t).getAllByRole("row")[1]).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(approve).toHaveBeenCalledWith("lp-001", "high"));
    expect(await screen.findByText(/Approved as LR-000007/)).toBeInTheDocument();
    fireEvent.click(within(within(t).getAllByRole("row")[1]).getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(screen.getByText(/Rejected\./)).toBeInTheDocument());
  });

  it("shows a viewer the learned rules but no decision", async () => {
    granted = ["view"];
    render();
    fireEvent.click(await screen.findByRole("button", { name: "Learned 2" }));
    const t = await screen.findByRole("table", { name: "Learned rules waiting for a decision" });
    expect(within(t).queryByRole("button", { name: "Approve" })).toBeNull();
    expect(within(t).queryByRole("button", { name: "Reject" })).toBeNull();
    expect(within(t).getAllByText("Waiting for an approver")).toHaveLength(2);
  });

  it("lets a rule manager reject but not approve", async () => {
    granted = ["view", "manage_rules"];
    render();
    fireEvent.click(await screen.findByRole("button", { name: "Learned 2" }));
    const t = await screen.findByRole("table", { name: "Learned rules waiting for a decision" });
    expect(within(t).queryByRole("button", { name: "Approve" })).toBeNull();
    expect(within(t).getAllByRole("button", { name: "Reject" })).toHaveLength(2);
  });

  it("hides Drafts from a role without manage_rules", async () => {
    granted = ["view", "approve"];
    render();
    await screen.findByRole("button", { name: "Learned 2" });
    expect(screen.queryByRole("button", { name: /^Drafts/ })).toBeNull();
  });

  it("shows Drafts to a rule manager, with a dry run and publish", async () => {
    granted = ["view", "manage_rules"];
    render();
    fireEvent.click(await screen.findByRole("button", { name: "Drafts 1" }));
    const t = await screen.findByRole("table", { name: "Rule drafts" });
    expect(norm(within(t).getAllByRole("row")[1])).toContain("ZR000412 Net weight above gross weight");
    fireEvent.click(within(t).getByRole("button", { name: "Dry run ZR000412" }));
    expect(await within(t).findByText("212 of 61,816 records would fail")).toBeInTheDocument();
    fireEvent.click(within(t).getByRole("button", { name: "Publish ZR000412" }));
    await waitFor(() => expect(screen.getByText(/ZR000412: Net weight above gross weight is published/)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button", { name: "Drafts 0" })).toBeInTheDocument());
  });
});

describe("on a phone", () => {
  const original = window.matchMedia;
  beforeEach(() => {
    window.matchMedia = ((query: string) => ({ matches: true, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;
  });
  afterEach(() => {
    window.matchMedia = original;
  });

  it("lists the rules as two-line rows under a header that carries the i popovers, and the closing 'and N more rules'", async () => {
    render();
    const list = await screen.findByRole("list", { name: "Rules for Material master" });
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(9));
    const first = within(list).getAllByRole("listitem")[0];
    expect(norm(first)).toContain("MM014 Base unit of measure not valid");
    expect(norm(first)).toContain("1,184,000");
    await waitFor(() => expect(norm(first)).toContain("over tolerance"));
    expect(norm(within(list).getAllByRole("listitem")[8])).toContain("and 905 more rules");
    for (const name of ["Value at risk", "Over tolerance", "Failing %", "Coverage"]) expect(screen.getByRole("button", { name: `About ${name}` })).toBeInTheDocument();
    expect(within(list).queryByRole("button", { name: /^About/ })).toBeNull(); // the header is outside the list
  });

  it("accepts all suggested values from the list", async () => {
    const spy = vi.spyOn(objectApi, "acceptAllSuggested").mockResolvedValue({ accepted: 112, draft_batch_id: "B-243" });
    render();
    const list = await screen.findByRole("list", { name: "Rules for Material master" });
    fireEvent.click(await within(list).findByRole("button", { name: "Accept all 112 suggested values for MM014" }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith("MM014", "d3229ded-0708-4967-9dfb-1b7f4fada953"));
  });
});

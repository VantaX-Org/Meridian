import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { FindingRecordsSheet, RecordDetailSheet, RuleReadsSheet, findingRecordsId, recordDetailId } from "../RecordSheets";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

const S = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@/design/next/shell/SheetHost", async (orig) => ({ ...(await orig<object>()), useSheets: () => ({ open: S.open, close: vi.fn(), dismiss: vi.fn(), setStep: vi.fn(), stack: [], step: null }) }));

const RUN = "d3229ded-0708-4967-9dfb-1b7f4fada953";

beforeEach(() => {
  setUrl("/objects/material_master?fixture=1");
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  S.open.mockReset();
});

describe("Record detail sheet", () => {
  it("shows the record's fields with their business names and the rules it fails", async () => {
    renderWithQuery(<RecordDetailSheet id={recordDetailId(RUN, "material_master", "MAT-1")} close={() => {}} />);
    const body = await screen.findByTestId("record-detail");
    await waitFor(() => expect(within(body).getByText("MM003")).toBeTruthy());
    expect(within(body).getByText("Raw material")).toBeTruthy();
    await waitFor(() => expect(within(body).getAllByText("Material type").length).toBeGreaterThan(0));
    expect(within(body).getByText("Critical")).toBeTruthy();
  });

  it("opens every failing record of a rule at the same run", async () => {
    renderWithQuery(<RecordDetailSheet id={recordDetailId(RUN, "material_master", "MAT-1")} close={() => {}} />);
    const buttons = await screen.findAllByRole("button", { name: "Every failing record" });
    fireEvent.click(buttons[0]);
    expect(S.open).toHaveBeenCalledWith({ kind: "finding-records", id: findingRecordsId(RUN, "MM003") });
  });

  it("encodes ids so a key may hold the separator", () => {
    expect(recordDetailId(null, "material_master", "A~B")).toBe("~material_master~A%7EB");
    expect(findingRecordsId(RUN, "MM~1").split("~")).toHaveLength(2);
  });
});

describe("Failing records sheet", () => {
  it("lists the failing records and opens one as a record sheet", async () => {
    renderWithQuery(<FindingRecordsSheet id={findingRecordsId(RUN, "MM003")} close={() => {}} />);
    const body = await screen.findByTestId("finding-records");
    const table = await within(body).findByRole("table");
    const rows = await waitFor(() => {
      const r = within(table).getAllByRole("row");
      expect(r.length).toBeGreaterThan(1);
      return r;
    });
    fireEvent.click(rows[1]);
    expect(S.open).toHaveBeenCalledWith(expect.objectContaining({ kind: "record-detail" }));
  });
});

describe("What a rule reads sheet", () => {
  it("shows fields, lookups, tables, joins, owners and glossary terms", async () => {
    renderWithQuery(<RuleReadsSheet id="MM003" close={() => {}} />);
    const body = await screen.findByTestId("rule-reads");
    await waitFor(() => expect(within(body).getAllByText("MARA-MEINS").length).toBe(2));
    expect(within(body).getByText("T006-MSEHI")).toBeTruthy();
    expect(within(body).getByText(/MARA to T006/)).toBeTruthy();
    expect(within(body).getByText("Thandi Mokoena")).toBeTruthy();
  });
});

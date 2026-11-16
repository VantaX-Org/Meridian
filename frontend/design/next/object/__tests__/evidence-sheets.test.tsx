import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { ToastProvider } from "@/design/next/kit";
import type { LandscapeCell } from "@/lib/api/v2/types";
import { RecordSheet, RuleSheet } from "../EvidenceSheet";
import { parseRecordId, historyLine } from "../RecordEvidence";
import { CapSentence, DimensionBars } from "../ScoreParts";

vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

const S = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@/design/next/shell/SheetHost", async (orig) => ({ ...(await orig<object>()), useSheets: () => ({ open: S.open, close: vi.fn(), dismiss: vi.fn(), setStep: vi.fn(), stack: [], step: null }) }));

beforeEach(() => {
  setUrl("/objects/material_master?fixture=1");
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  S.open.mockReset();
});

describe("Rule sheet", () => {
  it("renders the rule natively, with no legacy mount", async () => {
    const { container } = renderWithQuery(<ToastProvider><RuleSheet id="MM003" close={() => {}} under={false} /></ToastProvider>);
    await screen.findByTestId("rule-evidence");
    expect(container.ownerDocument.querySelector(".m2-root, [data-legacy]")).toBeNull();
  });
});

describe("Record sheet", () => {
  it("shows the record's fix blocks and provenance natively", async () => {
    renderWithQuery(<ToastProvider><RecordSheet id="material_master:MATNR=000000000000000232" close={() => {}} under={false} /></ToastProvider>);
    const body = await screen.findByTestId("record-evidence");
    await waitFor(() => expect(within(body).getAllByTestId("fix-block").length).toBeGreaterThan(0));
    expect(within(body).getAllByText("MM003").length).toBeGreaterThan(0);
  });

  it("reads a record that fails nothing straight from the run", async () => {
    renderWithQuery(<ToastProvider><RecordSheet id="material_master:MATNR=9" close={() => {}} under={false} /></ToastProvider>);
    expect(await screen.findByTestId("record-sheet")).toBeTruthy();
  });

  it("parses ids and words history rows", () => {
    expect(parseRecordId("material_master:A:B")).toEqual({ module: "material_master", key: "A:B" });
    expect(parseRecordId("X")).toEqual({ module: "", key: "X" });
    expect(historyLine({ check_id: null, action: "assign", to_value: "", note: null, user: null, at: "" } as never)).toBe("Unassigned");
  });
});

describe("Score parts", () => {
  it("names the capping rules", () => {
    renderWithQuery(<p><CapSentence capped cap={70} ids={["MM003"]} names={{ MM003: "Base unit is valid" }} /></p>);
    expect(screen.getByText(/Held at 70/)).toBeTruthy();
    expect(screen.getByText("MM003")).toBeTruthy();
  });

  it("says nothing holds the score down when nothing is capped", () => {
    renderWithQuery(<p><CapSentence capped={false} cap={null} ids={[]} /></p>);
    expect(screen.getByText("No critical rule is failing, so nothing holds this score down.")).toBeTruthy();
  });

  it("shows the six dimensions with their weights", () => {
    const cell = { module: "material_master", dimensions: { completeness: 80, validity: null } } as unknown as LandscapeCell;
    renderWithQuery(<DimensionBars cell={cell} />);
    const t = screen.getByTestId("dimension-bars");
    expect(within(t).getAllByRole("row").length).toBe(7);
    expect(within(t).getAllByText("not measured").length).toBeGreaterThan(0);
  });
});

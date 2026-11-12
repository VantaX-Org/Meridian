import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { resetWorkFixture } from "@/lib/api/v2/fixtures";
import { describeField, describeTable } from "@/lib/v2/sap-fields";
import { SapCode } from "../parts";
import { RecordCanvas } from "../screens/RecordCanvas";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetWorkFixture();
});
afterEach(() => window.sessionStorage.clear());

describe("RecordCanvas", () => {
  it("names each SAP table beside its code and links to the inspector for the actions", async () => {
    const key = "MATNR=000000000000000101";
    setUrl(`/o/ecc-production/material-master/records/${encodeURIComponent(key)}?fixture=1`);
    renderWithQuery(<RecordCanvas module="material-master" recordKey={encodeURIComponent(key)} />);
    const canvas = await screen.findByTestId("record-canvas");
    const tables = within(canvas).getAllByTestId("record-table");
    const mara = tables.find((t) => t.textContent?.includes("MARA"));
    expect(mara?.querySelector("h3")?.textContent).toContain("General material data");
    expect(within(canvas).getByTestId("record-act").getAttribute("href")).toContain("open=record");
  });

  it("says the record is not in the run when the API answers 404, without a retry", async () => {
    setUrl("/o/ecc-production/material-master/records/NOPE?fixture=1");
    renderWithQuery(<RecordCanvas module="material-master" recordKey="NOPE" />);
    expect(await screen.findByText(/No failing record with the key NOPE is in the latest run/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  });

  it("ignores an API description that only repeats the field name", () => {
    expect(describeField("MARA.MEINS", { "MARA.MEINS": "MEINS" })).toBe("Base unit of measure");
    expect(describeField("MARA.ZZX", { "MARA.ZZX": "MARA-ZZX" })).toBeNull();
    expect(describeField("MARA.ZZX", { "MARA.ZZX": "Custom flag" })).toBe("Custom flag");
    expect(describeTable("marc")).toBe("Plant data for material");
  });

  it("SapCode puts the standard text before a field or table code and leaves unknown codes bare", () => {
    const { container } = render(<><SapCode field="MARA-MEINS" />|<SapCode table="marc" />|<SapCode field="ZZFOO" /></>);
    const [a, b, c] = (container.textContent ?? "").split("|");
    expect(a).toMatch(/^.+ MARA-MEINS$/);
    expect(b).toBe("Plant data for material marc");
    expect(c).toBe("ZZFOO");
  });
});

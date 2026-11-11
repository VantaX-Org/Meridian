import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as adminApi from "@/lib/api/v2/admin";
import { resetAdminFixture } from "@/lib/api/v2/fixtures";
import { bandOf, bandsFor } from "@/lib/v2/thresholds";
import { QualityThresholdsBlock } from "../admin/thresholds";
import { RequestFormCanvas } from "../screens/RequestForm";
import { resetKeptOutcomes } from "../inspector/shared";
import { setUrl } from "./nav-store";
import { stubLayout } from "./layout-stub";

const h = vi.hoisted(() => ({ allowed: "all" as "all" | string[] }));

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("@/lib/v2/hooks", async (orig) => {
  const m = await orig<typeof import("@/lib/v2/hooks")>();
  return { ...m, useV2Session: () => ({ persona: "lead", label: "Programme lead", name: "Test", email: null, fixture: true, shared: false, can: (a: string) => h.allowed === "all" || h.allowed.includes(a) }) };
});

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetAdminFixture();
  resetKeptOutcomes();
  undo = stubLayout();
  h.allowed = "all";
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("quality bands", () => {
  const b = { target: 90, warning: 75, critical: 60 };
  it("puts a score in the band api/services/scoring.py band() gives it", () => {
    expect([90, 89.9, 75, 60, 59.9].map((s) => bandOf(s, b))).toEqual(["pass", "warn", "warn", "fail", "critical"]);
    expect(bandOf(null, b)).toBeNull();
    expect(bandOf(80, null)).toBeNull();
  });
  it("takes the module override, then the tenant default, then the score bands", () => {
    const q = { dimensions: ["overall", "validity"], fallback: b, tenant: { overall: { target: 95, warning: 85, critical: 70 } }, modules: { material_master: { validity: { target: 97, warning: 90, critical: 75 } } } };
    expect(bandsFor(q, "material_master", "validity")?.target).toBe(97);
    expect(bandsFor(q, "material_master", "overall")?.target).toBe(95);
    expect(bandsFor(q, "customer_master", "validity")).toEqual(b);
    expect(bandsFor(undefined, "x", "overall")).toBeNull();
  });
});

describe("Admin: quality thresholds", () => {
  it("is read only without manage settings", async () => {
    renderWithQuery(<QualityThresholdsBlock write={false} modules={["material_master"]} />);
    const table = await screen.findByTestId("quality-thresholds");
    expect(table.querySelector("input")).toBeNull();
    expect(within(table).queryByRole("button")).toBeNull();
    expect(table.textContent).toContain("Tenant default");
  });

  it("refuses bands out of order and saves a module override", async () => {
    const put = vi.spyOn(adminApi, "putQualityThreshold");
    renderWithQuery(<QualityThresholdsBlock write modules={["material_master"]} />);
    await screen.findByTestId("quality-thresholds");
    fireEvent.change(screen.getByTestId("threshold-scope"), { target: { value: "material_master" } });
    const row = screen.getByRole("rowheader", { name: "Validity" }).closest("tr") as HTMLElement;
    const [target] = within(row).getAllByRole("spinbutton");
    expect(target).toHaveValue(97);
    expect(row.textContent).toContain("This module");
    fireEvent.change(target, { target: { value: "50" } });
    expect(within(row).getByRole("alert")).toHaveTextContent("Critical must not exceed warning");
    expect(within(row).getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(target, { target: { value: "98" } });
    fireEvent.click(within(row).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(put).toHaveBeenCalledWith({ module: "material_master", dimension: "validity", target: 98, warning: 90, critical: 75 }));
    await waitFor(() => expect(document.body.textContent).toContain("Thresholds saved"), { timeout: 3000 });
    expect(screen.getByTestId("threshold-scope")).toHaveValue("material_master");
  });
});

describe("Data collection form", () => {
  it("needs the master data write permission", async () => {
    h.allowed = ["mdm.read"];
    setUrl("/requests/new?fixture=1");
    renderWithQuery(<RequestFormCanvas />);
    expect(await screen.findByText("Creating a request needs the master data write permission.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check against the rules" })).toBeNull();
  });

  it("builds the fields from the data dictionary, offers check-table values and shows rule failures inline", async () => {
    setUrl("/requests/new?fixture=1&object=material");
    renderWithQuery(<RequestFormCanvas />);
    const mara = await screen.findByTestId("form-table-MARA");
    const mtart = mara.querySelector("#fld-MARA\\.MTART") as HTMLSelectElement;
    expect(Array.from(mtart.options).map((o) => o.value)).toContain("FERT");
    expect(screen.getByText(/Still needed to create/)).toBeInTheDocument();
    fireEvent.change(mtart, { target: { value: "FERT" } });
    fireEvent.click(screen.getByRole("button", { name: "Check against the rules" }));
    const fail = await screen.findByTestId("field-failure");
    expect(fail.closest("[data-field]")?.getAttribute("data-field")).toBe("MARA.MATKL");
    expect(fail).toHaveTextContent("MM022");
    expect(screen.getByRole("button", { name: "Submit for approval" })).toBeDisabled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as api from "@/lib/api/v2/migration";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { ToastProvider } from "@/design/next/kit";
import { Analysis } from "../analysis/Analysis";

const view = () => renderWithQuery(<ToastProvider><Analysis /></ToastProvider>);

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

beforeEach(() => { window.sessionStorage.setItem("mn_v2_fixture", "1"); setUrl("/load/analysis?fixture=1"); });
afterEach(() => { window.sessionStorage.clear(); window.history.replaceState(null, "", "/"); vi.restoreAllMocks(); });

describe("Load analysis", () => {
  it("renders the latest analysis from the fixture", async () => {
    view();
    expect(await screen.findByTestId("mig-banner")).toBeTruthy();
    expect(screen.getByTestId("mig-runs")).toBeTruthy();
    expect(screen.getByTestId("mig-run-analysis")).toBeTruthy();
  });

  it("deletes an analysis through the confirm", async () => {
    const spy = vi.spyOn(api, "deleteMigrationRun").mockResolvedValue({});
    view();
    const runs = await screen.findByTestId("mig-runs");
    fireEvent.click(within(runs).getAllByRole("button", { name: /^Delete the analysis of/ })[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Delete the analysis" }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
  });

  it("hides the start actions when the role cannot analyse", async () => {
    window.history.replaceState(null, "", "/load/analysis?fixture=1&role=viewer");
    setUrl("/load/analysis?fixture=1&role=viewer");
    view();
    await screen.findByTestId("mig-banner");
    expect(screen.queryByTestId("mig-run-analysis")).toBeNull();
    expect(screen.queryByTestId("mig-start-open")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Delete the analysis of/ })).toBeNull();
  });

  it("downloads the dry-run report of a dry-run analysis", async () => {
    const spy = vi.spyOn(api, "exportDryRunReport").mockResolvedValue("s4_dry_run_mig-0001.xlsx");
    setUrl("/load/analysis?fixture=1&run=mig-0001");
    view();
    const panel = await screen.findByTestId("mig-dry-run-report");
    fireEvent.click(within(panel).getByRole("button", { name: "Download as Excel" }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith("mig-0001", "xlsx"));
  });

  it("saves a template column map", async () => {
    const spy = vi.spyOn(api, "saveTemplateMapping").mockResolvedValue({ column_map: {}, coverage: { columns: 5, matched: 5, sheets: [] } });
    view();
    fireEvent.click(await screen.findByTestId("mig-template-map-tpl-0001"));
    const form = await screen.findByTestId("mig-template-mapping");
    const select = await within(form).findByLabelText("Field for Legacy group") as HTMLSelectElement;
    const value = select.options[1].value;
    fireEvent.change(select, { target: { value } });
    fireEvent.click(within(form).getByRole("button", { name: "Save the column map" }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith("material_master", "tpl-0001", { "Basic Data::Legacy group": value }));
  });
});

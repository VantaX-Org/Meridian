import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { resetAdminFixture } from "@/lib/api/v2/fixtures";
import * as rep from "@/lib/api/v2/reports";
import { Inspector } from "../Inspector";
import { resetKeptOutcomes } from "../inspector/shared";
import { LandscapeCanvas } from "../screens/Landscape";
import { getUrl, setUrl } from "./nav-store";
import { stubLayout } from "./layout-stub";

const h = vi.hoisted(() => ({ allowed: "all" as "all" | string[] }));

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("@/lib/v2/hooks", async (orig) => {
  const m = await orig<typeof import("@/lib/v2/hooks")>();
  return { ...m, useV2Session: () => ({ persona: "lead", label: "Programme lead", name: "Test", email: null, fixture: true, can: (a: string) => h.allowed === "all" || h.allowed.includes(a) }) };
});

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.clear();
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

const text = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
const visit = (search = "") => {
  window.history.pushState({}, "", `/v2?fixture=1${search}`);
  setUrl(`/v2?fixture=1${search}`);
};
const page = () =>
  renderWithQuery(
    <>
      <LandscapeCanvas />
      <Inspector />
    </>,
  );

describe("the Waves view of the landscape", () => {
  it("is a toggle in the matrix header that puts the choice in the address", async () => {
    visit();
    page();
    const toggle = await screen.findByTestId("view-toggle");
    expect(within(toggle).getByRole("button", { name: "All objects" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryAllByTestId("wave-head")).toHaveLength(0);
    fireEvent.click(within(toggle).getByRole("button", { name: "Waves" }));
    expect(getUrl()).toContain("view=waves");
    await waitFor(() => expect(screen.getAllByTestId("wave-head")).toHaveLength(4));
    expect(within(screen.getByTestId("view-toggle")).getByRole("button", { name: "Waves" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(screen.getByTestId("view-toggle")).getByRole("button", { name: "All objects" }));
    expect(getUrl()).not.toContain("view=waves");
  });

  it("groups the rows by wave, each with its date and its go, at risk and no-go counts", async () => {
    visit("&view=waves");
    page();
    await waitFor(() => expect(screen.getAllByTestId("wave-head")).toHaveLength(4));
    const heads = screen.getAllByTestId("wave-head").map(text);
    expect(heads[0]).toBe("Wave 1: finance foundations due 16 Nov 2026 1 go, 0 at risk, 3 no-go Edit Certificate");
    expect(heads[1]).toBe("Wave 2: master data due 18 Jan 2027 0 go, 0 at risk, 3 no-go Edit Certificate");
    expect(heads[2]).toBe("Wave 3: operations no date set 0 go, 0 at risk, 3 no-go Edit Certificate");
    expect(heads[3]).toBe("Not in a wave 5 objects 1 go, 2 at risk, 2 no-go");
    const table = screen.getByTestId("coverage-matrix");
    const rowNames = Array.from(table.querySelectorAll(".m2-oname")).map((el) => el.textContent);
    expect(rowNames.slice(0, 4)).toEqual(["Vendor master (AP)", "G/L accounts", "Asset accounting", "Controlling"]);
    expect(rowNames).toHaveLength(15);
    // The counts of the waves add up to the matrix's own: 2 go, 2 at risk, 11 no-go.
    expect(screen.getByText("2 go, 2 at risk, 11 no-go")).toBeInTheDocument();
  });

  it("the lead's next step reads the next wave, and its line says when it is due", async () => {
    visit();
    page();
    const next = await screen.findByTestId("wave-next-step");
    expect(next).toHaveTextContent("Clear the 3 no-go objects in Wave 1: finance foundations");
    expect(text(screen.getByTestId("wave-next-when"))).toContain("due 16 Nov 2026");
  });

  it("with every no-go object cleared, the next step moves to the at-risk ones, then to the waves themselves", async () => {
    vi.spyOn(rep, "getWaves").mockResolvedValue([
      { id: "x", name: "Wave X", source_system_id: null, target_system_id: null, target_release: "2025", modules: ["gl_accounts", "quality_management"], target_date: "2026-12-01", stage: "plan", min_readiness: 95, min_dqs: null, signed_off_by: null, signed_off_at: null, created_at: "", updated_at: "" },
    ]);
    visit();
    page();
    expect(await screen.findByTestId("wave-next-step")).toHaveTextContent("Open Wave X");
    expect(screen.getByTestId("wave-next-step").getAttribute("href")).toContain("open=waves");
  });

  it("Edit on a wave opens the waves editor", async () => {
    visit("&view=waves");
    page();
    await waitFor(() => expect(screen.getAllByTestId("wave-head")).toHaveLength(4));
    const edit = screen.getByRole("link", { name: "Edit Wave 2: master data" });
    expect(edit.getAttribute("href")).toContain("open=waves");
    // Following the link is the router's job; here the address it leads to is opened.
    setUrl(edit.getAttribute("href") as string);
    expect(await screen.findByRole("dialog", { name: "Migration waves" })).toBeInTheDocument();
  });
});

describe("the waves editor", () => {
  it("lists the waves with date and stage, and every object with the wave it is in", async () => {
    visit("&open=waves");
    page();
    const dialog = await screen.findByRole("dialog", { name: "Migration waves" });
    const w1 = await within(dialog).findByRole("group", { name: "Wave Wave 1: finance foundations" });
    expect(within(w1).getByLabelText("Target date")).toHaveValue("2026-11-16");
    expect(within(w1).getByLabelText("Stage")).toHaveValue("mock2");
    const table = within(dialog).getByRole("table", { name: "Objects by wave" });
    expect(within(table).getByLabelText("Wave of Purchasing")).toHaveValue("w-3");
    expect(within(table).getByLabelText("Wave of HCM")).toHaveValue("");
  });

  it("assigns an object to another wave and saves only the waves that changed, with the date", async () => {
    const update = vi.spyOn(rep, "updateWave");
    visit("&open=waves");
    page();
    const dialog = await screen.findByRole("dialog", { name: "Migration waves" });
    const save = await within(dialog).findByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Wave of Purchasing"), { target: { value: "w-1" } });
    fireEvent.change(within(dialog).getByLabelText("Wave of HCM"), { target: { value: "w-2" } });
    const w3 = within(dialog).getByRole("group", { name: "Wave Wave 3: operations" });
    fireEvent.change(within(w3).getByLabelText("Target date"), { target: { value: "2027-03-01" } });
    expect(within(dialog).getByRole("button", { name: "Save 3 changes" })).toBeEnabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save 3 changes" }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(3));
    const calls = Object.fromEntries(update.mock.calls.map(([id, body]) => [id, body]));
    expect(calls["w-1"]).toEqual({ modules: ["gl_accounts", "asset_accounting", "controlling", "vendor_master", "purchasing"] });
    expect(calls["w-2"]).toEqual({ modules: ["material_master", "business_partner", "customer_master", "hcm"] });
    expect(calls["w-3"]).toEqual({ target_date: "2027-03-01", modules: ["sales_orders", "plant_maintenance"] });
    expect(await within(dialog).findByTestId("action-result")).toHaveTextContent("3 waves updated");
    await waitFor(() => expect(within(dialog).getByLabelText("Wave of Purchasing")).toHaveValue("w-1"));
  });

  it("adds a wave with a name, a date and a stage", async () => {
    const create = vi.spyOn(rep, "createWave");
    visit("&open=waves");
    page();
    const dialog = await screen.findByRole("dialog", { name: "Migration waves" });
    const add = await within(dialog).findByRole("button", { name: "Add the wave" });
    expect(add).toBeDisabled();
    fireEvent.change(within(dialog).getByPlaceholderText("Wave 4: warehouse"), { target: { value: "Wave 4: HR" } });
    fireEvent.click(add);
    await waitFor(() => expect(create).toHaveBeenCalledWith({ name: "Wave 4: HR", modules: [], target_date: null, stage: "plan", min_readiness: 95 }));
    await waitFor(() => expect(within(dialog).getByRole("group", { name: "Wave Wave 4: HR" })).toBeInTheDocument());
  });

  it("deletes a wave only after a confirmation", async () => {
    const remove = vi.spyOn(rep, "deleteWave");
    visit("&open=waves");
    page();
    const dialog = await screen.findByRole("dialog", { name: "Migration waves" });
    fireEvent.click(await within(dialog).findByRole("button", { name: "Delete Wave 3: operations" }));
    const confirm = await screen.findByRole("dialog", { name: "Delete Wave 3: operations" });
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete the wave" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith("w-3"));
  });

  it("is read only without the analyse permission", async () => {
    h.allowed = ["view"];
    visit("&open=waves");
    page();
    const dialog = await screen.findByRole("dialog", { name: "Migration waves" });
    expect(await within(dialog).findByText(/Changing waves needs the analyse permission/)).toBeInTheDocument();
    const w1 = within(dialog).getByRole("group", { name: "Wave Wave 1: finance foundations" });
    expect(within(w1).getByLabelText("Target date")).toBeDisabled();
    expect(within(dialog).getByLabelText("Wave of Purchasing")).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(within(dialog).queryByRole("button", { name: "Add the wave" })).toBeNull();
  });
});

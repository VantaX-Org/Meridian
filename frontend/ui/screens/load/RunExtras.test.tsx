import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderScreen } from "./test-utils";
import { stubLayout } from "@/ui/testing/layout-stub";
import { ReconRecords, TargetWorkbook, ValueMapping } from "./RunExtras";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);

const can = vi.hoisted(() => ({ allow: true }));
vi.mock("@/ui/screens/orphans/useCan", () => ({ useCan: () => () => can.allow }));

let undo: () => void = () => undefined;
beforeEach(() => {
  can.allow = true;
  undo = stubLayout();
  window.history.replaceState(null, "", "/load/runs/mig-0002?fixture=1");
});
afterEach(() => undo());

describe("ValueMapping", () => {
  it("asks for a field first, then lists unmapped values", async () => {
    renderScreen(<ValueMapping id="mig-0002" modules={["material_master"]} />);
    expect(await screen.findByText("Choose a target field")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("MARA.MTART"), { target: { value: "mara.mtart" } });
    fireEvent.click(screen.getByRole("button", { name: "Find unmapped values" }));
    expect(await screen.findByText("ZROH")).toBeTruthy();
  });

  it("previews the proposal in a confirm before saving", async () => {
    renderScreen(<ValueMapping id="mig-0002" modules={["material_master"]} />);
    fireEvent.change(screen.getByPlaceholderText("MARA.MTART"), { target: { value: "MARA.MTART" } });
    fireEvent.click(screen.getByRole("button", { name: "Find unmapped values" }));
    await screen.findByText("ZROH");
    const propose = screen.getByRole("button", { name: "Propose mappings" }) as HTMLButtonElement;
    expect(propose.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Target value for ZROH"), { target: { value: "ROH" } });
    expect(propose.disabled).toBe(false);
    fireEvent.click(propose);
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    expect(screen.getByText(/Nothing is loaded/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Propose mappings" }).at(-1) as HTMLElement);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("disables proposing without the analyse permission and says why", async () => {
    can.allow = false;
    renderScreen(<ValueMapping id="mig-0002" modules={["material_master"]} />);
    fireEvent.change(screen.getByPlaceholderText("MARA.MTART"), { target: { value: "MARA.MTART" } });
    fireEvent.click(screen.getByRole("button", { name: "Find unmapped values" }));
    await screen.findByText("ZROH");
    expect((screen.getByRole("button", { name: "Propose mappings" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByText("You need the analyse permission to propose value mappings").length).toBeGreaterThan(0);
  });
});

describe("ReconRecords", () => {
  it("lists records and notes the per-kind cap", async () => {
    renderScreen(<ReconRecords id="mig-0002" tables={[]} />);
    expect(await screen.findByText(/at most 100 records per kind/)).toBeTruthy();
    expect((await screen.findAllByRole("row")).length).toBeGreaterThan(1);
  });

  it("starts on the first page with the previous button off", async () => {
    renderScreen(<ReconRecords id="mig-0002" tables={[]} />);
    await screen.findByText(/at most 100 records per kind/);
    expect((screen.getByRole("button", { name: "Previous" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("TargetWorkbook", () => {
  it("explains when the run has no source extraction", () => {
    renderScreen(<TargetWorkbook versionId={null} />);
    expect(screen.getByText("This run has no source extraction")).toBeTruthy();
  });

  it("checks a chosen workbook and shows what is held", async () => {
    renderScreen(<TargetWorkbook versionId="v1" />);
    const check = screen.getByRole("button", { name: "Check the workbook" }) as HTMLButtonElement;
    expect(check.disabled).toBe(true);
    const input = screen.getByLabelText("The new system's workbook") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "wb.xlsx")] } });
    await waitFor(() => expect(check.disabled).toBe(false));
    fireEvent.click(check);
    expect(await screen.findAllByText("Job Information")).toBeTruthy();
    expect(await screen.findByText("Nothing is stored", { exact: false })).toBeTruthy();
  });
});

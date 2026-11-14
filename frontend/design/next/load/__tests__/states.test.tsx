import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { ToastProvider } from "@/design/next/kit";
import { ApproveFlow } from "../../flows/ApproveFlow";
import { LoadPrepareFlow, LOAD_STEPS, readSaved, writeSaved } from "../../flows/LoadPrepareFlow";
import { Load } from "../../screens/Load";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { compactInt, Denied, StaleNudge, Trunc, useGuard } from "../states";
import { searchRuns, targetsFor } from "../tabs";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

beforeEach(() => window.sessionStorage.setItem("mn_v2_fixture", "1"));
afterEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe("shared states", () => {
  it("shortens very large counts and keeps zero", () => {
    expect(compactInt(0)).toBe("0");
    expect(compactInt(9_999)).toBe("9,999");
    expect(compactInt(1_250_000)).toBe("1.3M");
    expect(compactInt(null)).toBe("—");
  });

  it("puts a long name in the tooltip and leaves a short one alone", () => {
    const long = "A very long object name that does not fit in a table cell at all";
    const { rerender } = render(<Trunc text={long} />);
    expect(screen.getByTestId("trunc").getAttribute("title")).toBe(long);
    rerender(<Trunc text="Short" />);
    expect(screen.getByTestId("trunc").getAttribute("title")).toBeNull();
  });

  it("offers the newer run from the stale nudge", () => {
    const open = vi.fn();
    render(<StaleNudge newer="mig-0009" onOpen={open} />);
    expect(screen.getByTestId("stale-nudge").textContent).toMatch(/mig-0009/);
    fireEvent.click(screen.getByRole("button", { name: "Switch to the newer run" }));
    expect(open).toHaveBeenCalled();
  });

  it("names the missing right when access is denied", () => {
    render(<Denied right="export" />);
    expect(screen.getByTestId("denied").textContent).toMatch(/export right/);
  });

  it("ignores a second click while the first is in flight", async () => {
    const fn = vi.fn(() => new Promise<void>((r) => setTimeout(r, 20)));
    const held: { guard?: ReturnType<typeof useGuard> } = {};
    function Probe() {
      const g = useGuard();
      useEffect(() => { held.guard = g; });
      return null;
    }
    render(<Probe />);
    await act(async () => {
      void held.guard!.run(fn);
      void held.guard!.run(fn);
      await new Promise((r) => setTimeout(r, 40));
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("the target picker", () => {
  it("never offers SuccessFactors for material master, and never SAP targets for a people object", () => {
    expect(targetsFor(["material_master"])).not.toContain("sf");
    expect(targetsFor(["employee_central"])).toEqual(["sf", "workbook"]);
    expect(targetsFor(["material_master", "employee_central"])).toContain("sf");
    expect(targetsFor(["material_master", "employee_central"])).toContain("s4");
  });

  it("searches runs by number or object name", () => {
    const runs = [{ id: "mig-0002", modules: ["material_master"] }, { id: "mig-0003", modules: ["business_partner"] }];
    const label = (m: string) => m.replace("_", " ");
    expect(searchRuns(runs, "0003", label)).toHaveLength(1);
    expect(searchRuns(runs, "material", label)[0].id).toBe("mig-0002");
    expect(searchRuns(runs, "  ", label)).toHaveLength(2);
    expect(searchRuns(runs, "zzz", label)).toHaveLength(0);
  });
});

describe("the load sheet", () => {
  const flow = (step = 1, id = "mig-0002") => {
    const setStep = vi.fn();
    const close = vi.fn();
    renderWithQuery(<ToastProvider><LoadPrepareFlow id={id} step={step} setStep={setStep} close={close} under={false} /></ToastProvider>);
    return { setStep, close };
  };

  it("has six steps", () => {
    expect(LOAD_STEPS()).toHaveLength(6);
  });

  it("shows the choose-target step first, with the upload for a target workbook", async () => {
    flow(1);
    expect(await screen.findByTestId("load-step-1")).toBeTruthy();
    fireEvent.click(await screen.findByTestId("target-workbook"));
    expect(await screen.findByTestId("target-workbook-file")).toBeTruthy();
    expect(screen.queryByTestId("target-sf")).toBeNull();
  });

  it("blocks the hand-over until the approval is given", async () => {
    flow(5);
    await screen.findByTestId("load-run");
    expect(screen.getByRole("button", { name: "Hand over the files" }).getAttribute("aria-disabled")).toBe("true");
  });

  it("restores the target and objects after a refresh", async () => {
    writeSaved("mig-0002", { target: "ecc", objects: ["material_master"] });
    expect(readSaved("mig-0002")).toEqual({ target: "ecc", objects: ["material_master"] });
    flow(1);
    await waitFor(() => expect(screen.getByTestId("target-ecc").getAttribute("aria-checked")).toBe("true"));
  });

  it("says so when the run does not exist", async () => {
    flow(1, "mig-9999");
    expect(await screen.findByTestId("load-no-run")).toBeTruthy();
  });
});

describe("the approve sheet", () => {
  it("starts with the totals and moves to the approval", async () => {
    const setStep = vi.fn();
    renderWithQuery(<ToastProvider><ApproveFlow id="mig-0002" step={1} setStep={setStep} close={() => undefined} under={false} /></ToastProvider>);
    expect(await screen.findByTestId("approve-step-1")).toBeTruthy();
    await screen.findByTestId("approve-totals");
    expect(await screen.findByTestId("approve-bar")).toBeTruthy();
  });

  it("shows the approval step", async () => {
    renderWithQuery(<ToastProvider><ApproveFlow id="mig-0002" step={2} setStep={() => undefined} close={() => undefined} under={false} /></ToastProvider>);
    expect(await screen.findByTestId("approve-step-2")).toBeTruthy();
  });
});

describe("the load page states", () => {
  it("offers the load, templates and the trio", async () => {
    setUrl("/load?fixture=1");
    renderWithQuery(<ToastProvider><Load tab="prepare" /></ToastProvider>);
    expect(await screen.findByTestId("load-actions")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open the load" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Migration templates" })).toBeTruthy();
    expect(await screen.findByTestId("paired-trio")).toBeTruthy();
    for (const k of ["source", "projected", "actual"]) expect(screen.getByTestId(`ring-${k}`)).toBeTruthy();
  });
});

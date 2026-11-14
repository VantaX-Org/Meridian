import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { ToastProvider } from "@/design/next/kit";
import { CycleTab } from "../CycleTab";
import { useObjectRun } from "../useObjectRun";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { CheckList } from "../cycle/UploadStep";
import { RunSwitcher, type RunOption } from "@/design/next/kit";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

beforeEach(() => window.sessionStorage.setItem("mn_v2_fixture", "1"));
afterEach(() => {
  window.sessionStorage.clear();
  vi.clearAllMocks();
});

const IDS = ["fingerprint", "run", "template", "columns", "rows", "keys", "values", "formulas"] as const;

// The cycle is no longer an object page tab, so the test mounts the cycle steps directly.
function Cycle() {
  return <CycleTab o={useObjectRun("ecc-production", "material-master")} />;
}

async function addFile(name: string) {
  setUrl("/next/o/ecc-production/material-master/cycle?fixture=1&step=upload");
  renderWithQuery(<ToastProvider><Cycle /></ToastProvider>);
  const step = await screen.findByTestId("upload-step");
  const input = step.querySelector("input[type=file]") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["x"], name)] } });
  await screen.findByTestId("check-list");
}
const upload = () => screen.getByRole("button", { name: /Upload and score/ });
const off = (b: HTMLElement) => b.getAttribute("aria-disabled") === "true" || (b as HTMLButtonElement).disabled;

describe("upload checks", () => {
  it("lists every check with its status", () => {
    renderWithQuery(<CheckList checks={IDS.map((id) => ({ id, status: "pass" as const, detail: "" }))} />);
    for (const id of IDS) expect(screen.getByTestId(`check-${id}`).getAttribute("data-status")).toBe("pass");
  });
  it("a passing workbook can be uploaded", async () => {
    await addFile("cleaned.xlsx");
    await waitFor(() => expect(off(upload())).toBe(false));
  });
  it("a failed check blocks the upload", async () => {
    await addFile("bad.xlsx");
    expect(screen.getByTestId("check-columns").getAttribute("data-status")).toBe("fail");
    expect(off(upload())).toBe(true);
  });
  it("a warning needs the confirmation", async () => {
    await addFile("warn.xlsx");
    expect(screen.getByTestId("check-template").getAttribute("data-status")).toBe("warn");
    expect(off(upload())).toBe(true);
    fireEvent.click(within(screen.getByTestId("upload-step")).getByTestId("confirm-warnings"));
    await waitFor(() => expect(off(upload())).toBe(false));
  });
});

describe("run picker", () => {
  const runs: RunOption[] = [
    { id: "a", number: 1, status: "done", kind: "Extracted", dateLabel: "1 Nov", dqs: "70", records: "1,200" },
    { id: "b", number: 2, status: "done", kind: "Cleaned", parentNumber: 1, dateLabel: "8 Nov", dqs: "77", records: "1,180" },
  ];
  it("marks the latest, shows record counts and filters by them", () => {
    renderWithQuery(<RunSwitcher runs={runs} value="b" onChange={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /Run 2/ }));
    const rows = screen.getAllByRole("option");
    expect(within(rows[0]).getByText("Latest")).toBeTruthy();
    expect(within(rows[0]).getByText(/1,180 records/)).toBeTruthy();
    expect(within(rows[1]).queryByText("Latest")).toBeNull();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "1,200" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });
  it("picks with the keyboard", () => {
    const pick = vi.fn();
    renderWithQuery(<RunSwitcher runs={runs} value="b" onChange={pick} />);
    fireEvent.keyDown(screen.getByRole("button", { name: /Run 2/ }), { key: "ArrowDown" });
    const box = screen.getByRole("combobox");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(pick).toHaveBeenCalledWith("a");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderScreen } from "./test-utils";
import { stubLayout } from "@/ui/testing/layout-stub";
import { ToastHost } from "@/ui/kit";
import { Wave } from "./Wave";
import { downloadWaveReport } from "@/lib/api/v2/reports";

vi.mock("@/lib/api/v2/reports", async (orig) => ({ ...(await orig<typeof import("@/lib/api/v2/reports")>()), downloadWaveReport: vi.fn(() => Promise.reject(new Error("boom"))) }));
vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  undo = stubLayout();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/load/waves/w-1?fixture=1");
});
afterEach(() => undo());

describe("Wave", () => {
  it("renders its title and real rows in fixture mode", async () => {
    renderScreen(<Wave id="w-1" />);
    expect(await screen.findByRole("heading", { level: 1, name: "Wave 1: finance foundations" })).toBeTruthy();
    expect((await screen.findAllByRole("row")).length).toBeGreaterThan(0);
    expect(document.body.textContent ?? "").not.toContain(String.fromCharCode(0xb7));
  });

  it("shows the reason with Retry when the report export fails", async () => {
    renderScreen(<ToastHost><Wave id="w-1" /></ToastHost>);
    fireEvent.click(await screen.findByRole("button", { name: "Export report" }));
    fireEvent.click(await screen.findByRole("button", { name: "Export" }));
    expect((await screen.findByRole("alert")).textContent).toContain("boom");
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(downloadWaveReport).toHaveBeenCalledWith("w-1", "xlsx");
  });

  it("disables the export while a report is being made", async () => {
    vi.mocked(downloadWaveReport).mockImplementationOnce(() => new Promise(() => undefined));
    renderScreen(<ToastHost><Wave id="w-1" /></ToastHost>);
    fireEvent.click(await screen.findByRole("button", { name: "Export report" }));
    fireEvent.click(await screen.findByRole("button", { name: "Export" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Export" }) as HTMLButtonElement).disabled).toBe(true));
  });
});

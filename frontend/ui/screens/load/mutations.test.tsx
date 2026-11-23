import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderScreen } from "./test-utils";
import { stubLayout } from "@/ui/testing/layout-stub";
import { Pairs } from "./Pairs";
import { Pair } from "./Pair";
import { Load } from "./Load";
import { MigrationRun } from "./MigrationRun";
import { GoLive } from "./GoLive";
import { Templates } from "./Templates";
import { ToastHost } from "@/ui/kit";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);

const runPair = vi.fn();

const deletePair = vi.fn();
vi.mock("@/lib/api/v2/compare", async (orig) => ({ ...(await orig<typeof import("@/lib/api/v2/compare")>()), runPair: (id: string) => runPair(id), deletePair: (id: string) => deletePair(id) }));
const signCertificate = vi.fn();
vi.mock("@/lib/api/v2/step9", async (orig) => ({ ...(await orig<typeof import("@/lib/api/v2/step9")>()), signCertificate: (...a: unknown[]) => signCertificate(...a), getCertificates: async (w: string) => ({ wave_id: w, required_signers: [], versions: [{ id: "v1", version: 1, status: "issued", sha256: "x", report_file_id: null, issued_by: null, issued_at: "2026-11-01T00:00:00Z", measured_on: [], signatures: [] }] }) }));
const reject = vi.fn((): Promise<never> => Promise.reject(new Error("down")));
vi.mock("@/lib/api/v2/migration", async (orig) => ({ ...(await orig<typeof import("@/lib/api/v2/migration")>()), getReconciliation: () => reject(), getTemplateFields: () => reject() }));

const failed = { isLoading: false, isError: true, data: undefined, refetch: vi.fn() };
vi.mock("@/lib/api/next/load", async (orig) => {
  const m = await orig<typeof import("@/lib/api/next/load")>();
  return { ...m, useLoadRuns: () => (window.location.search.includes("down=1") ? failed : m.useLoadRuns()) };
});

let undo: () => void = () => undefined;
beforeEach(() => {
  undo = stubLayout();
  runPair.mockReset();
  deletePair.mockReset();
  signCertificate.mockReset();
  window.history.replaceState(null, "", "/load?fixture=1");
});
afterEach(() => undo());

describe("Load mutations surface failure", () => {
  it("Pairs shows an error when a comparison cannot start", async () => {
    runPair.mockRejectedValue(new Error("boom"));
    renderScreen(<ToastHost><Pairs /></ToastHost>);
    fireEvent.click((await screen.findAllByRole("button", { name: "Run comparison" }))[0]);
    expect(await screen.findByText("The comparison could not be started")).toBeTruthy();
  });

  it("Pair shows an error when a comparison cannot start", async () => {
    runPair.mockRejectedValue(new Error("boom"));
    renderScreen(<ToastHost><Pair id="pair-0001" /></ToastHost>);
    fireEvent.click(await screen.findByRole("button", { name: "Run comparison" }));
    await waitFor(() => expect(screen.getByText("The comparison could not be started")).toBeTruthy());
  });

  it("Load shows Unavailable, not 0, when the runs query fails", async () => {
    window.history.replaceState(null, "", "/load?fixture=1&down=1");
    renderScreen(<Load />);
    expect(await screen.findByText("Unavailable")).toBeTruthy();
  });

  it("Pairs removes a pair after confirm, and toasts when the delete fails", async () => {
    deletePair.mockRejectedValue(new Error("boom"));
    renderScreen(<ToastHost><Pairs /></ToastHost>);
    fireEvent.click((await screen.findAllByRole("button", { name: "Remove" }))[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" }).slice(-1)[0]);
    expect(await screen.findByText("The pair could not be deleted")).toBeTruthy();
    expect(deletePair).toHaveBeenCalledTimes(1);
  });

  it("Run detail shows the reconciliation error with a retry", async () => {
    window.history.replaceState(null, "", "/load/runs/mig-0002?fixture=1");
    renderScreen(<ToastHost><MigrationRun id="mig-0002" /></ToastHost>);
    fireEvent.click(await screen.findByRole("tab", { name: "Reconciliation" }));
    expect(await screen.findByText(/could not be loaded/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("GoLive disables Sign while the signature is saving", async () => {
    signCertificate.mockReturnValue(new Promise(() => undefined));
    window.history.replaceState(null, "", "/load/go-live?fixture=1");
    renderScreen(<ToastHost><GoLive /></ToastHost>);
    const sign = (await screen.findAllByRole("button", { name: "Sign" }))[0] as HTMLButtonElement;
    fireEvent.click(sign);
    await waitFor(() => expect(sign.disabled).toBe(true));
  });

  it("Templates says so when the target fields cannot load", async () => {
    window.history.replaceState(null, "", "/load/templates?fixture=1");
    renderScreen(<ToastHost><Templates /></ToastHost>);
    expect(await screen.findByText("The target fields could not be loaded")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});

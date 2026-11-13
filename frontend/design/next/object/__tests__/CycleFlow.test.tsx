import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { ToastProvider } from "@/design/next/kit";
import { ObjectPage } from "@/design/next/screens/ObjectPage";
import { setUrl } from "@/design/v2/__tests__/nav-store";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

beforeEach(() => window.sessionStorage.setItem("mn_v2_fixture", "1"));
afterEach(() => {
  window.sessionStorage.clear();
  vi.clearAllMocks();
});

function open(step: string) {
  setUrl(`/next/o/ecc-production/material-master/cycle?fixture=1&step=${step}`);
  renderWithQuery(<ToastProvider><ObjectPage system="ecc-production" module="material-master" tab="cycle" /></ToastProvider>);
}
const off = (b: HTMLElement) => b.getAttribute("aria-disabled") === "true" || (b as HTMLButtonElement).disabled;
const primary = () => within(screen.getByTestId("flow-bar")).getAllByRole("button").find((b) => b.className.includes("primary"))!;

describe("cleaning cycle as a flow", () => {
  it("shows one step with one primary action", async () => {
    open("clean");
    await screen.findByTestId("flow-step-clean");
    expect(screen.getByTestId("flow-count").textContent).toMatch(/3|2/);
    expect(document.querySelectorAll(".nx-btn-primary").length).toBe(1);
  });
  it("a warning on the clean step blocks Next until it is confirmed", async () => {
    open("clean");
    await screen.findByTestId("flow-step-clean");
    expect(screen.getByTestId("gate-download").getAttribute("data-status")).toBe("warn");
    expect(off(primary())).toBe(true);
    fireEvent.click(screen.getByTestId("confirm-skip-download"));
    await waitFor(() => expect(off(primary())).toBe(false));
  });
  it("a failed upload check blocks the primary action; a clean file frees it", async () => {
    open("upload");
    const step = await screen.findByTestId("upload-step");
    const input = step.querySelector("input[type=file]") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "bad.xlsx")] } });
    await screen.findByTestId("check-list");
    expect(screen.getByTestId("check-fingerprint").getAttribute("data-status")).toBe("fail");
    expect(off(primary())).toBe(true);
  });
  it("a clean file frees the primary action", async () => {
    open("upload");
    const step = await screen.findByTestId("upload-step");
    fireEvent.change(step.querySelector("input[type=file]") as HTMLInputElement, { target: { files: [new File(["x"], "cleaned.xlsx")] } });
    await waitFor(() => expect(screen.getByTestId("check-fingerprint").getAttribute("data-status")).toBe("pass"));
    await waitFor(() => expect(off(primary())).toBe(false));
  });
  it("a warned upload needs the confirmation", async () => {
    open("upload");
    const step = await screen.findByTestId("upload-step");
    fireEvent.change(step.querySelector("input[type=file]") as HTMLInputElement, { target: { files: [new File(["x"], "warn.xlsx")] } });
    await screen.findByTestId("check-list");
    expect(off(primary())).toBe(true);
    fireEvent.click(screen.getByTestId("confirm-warnings"));
    await waitFor(() => expect(off(primary())).toBe(false));
  });
});

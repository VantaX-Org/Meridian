import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as sys from "@/lib/api/v2/sys";
import * as runs from "@/lib/v2/runs-queries";
import { ConnectCanvas } from "../screens/system/ConnectCanvas";
import { stubLayout } from "./layout-stub";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  setUrl("/s/new");
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("First-run setup", () => {
  it("lets a SuccessFactors-only install skip SAP and opens the SuccessFactors form already set to that type", async () => {
    renderWithQuery(<ConnectCanvas />);
    fireEvent.click(await screen.findByRole("button", { name: "I only use SuccessFactors" }));
    const form = await screen.findByTestId("connection-form");
    expect((form.querySelector("select") as HTMLSelectElement).value).toBe("successfactors");
    expect(screen.getByLabelText("Company ID")).toBeTruthy();
    // With no SAP system, SuccessFactors cannot be skipped too.
    expect(screen.queryByRole("button", { name: "Skip for now" })).toBeNull();
  });

  it("shows the saved system instead of a second form when going back, so it cannot be registered twice", async () => {
    vi.spyOn(sys, "registerSystem").mockResolvedValue({ id: "s1", name: "ECC test" } as never);
    vi.spyOn(runs, "useSystemObjectList").mockReturnValue({ data: { system_type: "ecc", objects: [] }, isLoading: false, isError: false, refetch: vi.fn() } as never);
    renderWithQuery(<ConnectCanvas />);
    const form = await screen.findByTestId("connection-form");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "ECC test" } });
    fireEvent.change(screen.getByLabelText(/^Host/), { target: { value: "sap-ecc.internal" } });
    fireEvent.change(screen.getByLabelText(/^Client/), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText(/^Instance number/), { target: { value: "00" } });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: "x" } });
    fireEvent.submit(form);
    await waitFor(() => expect(sys.registerSystem).toHaveBeenCalledTimes(1));
    // Back to step one: a saved notice, no form.
    fireEvent.click(await screen.findByRole("button", { name: /Connect SAP/ }));
    expect(await screen.findByTestId("setup-saved")).toHaveTextContent("ECC test is connected.");
    expect(screen.queryByTestId("connection-form")).toBeNull();
  });
});

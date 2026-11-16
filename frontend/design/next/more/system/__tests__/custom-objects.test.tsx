import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { landscapeFixture, resetWorkFixture } from "@/lib/api/v2/fixtures";
import * as sys from "@/lib/api/v2/sys";
import { ToastProvider } from "../../../kit";
import { CustomObjects } from "../CustomObjects";

let allowed = true;
vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/lib/v2/hooks", async (orig) => ({ ...(await orig<object>()), useV2Session: () => ({ can: () => allowed, id: "me", name: "Me", email: "me@example.com", persona: "admin", label: "Admin", fixture: true, viewAs: null, shared: false }) }));

const [ECC] = landscapeFixture.systems;
const show = (part = "registry") => {
  setUrl(`/more/systems/${ECC.id}?fixture=1&tab=custom-objects&part=${part}`);
  return renderWithQuery(<ToastProvider><CustomObjects id={ECC.id} /></ToastProvider>);
};

beforeEach(() => {
  allowed = true;
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetWorkFixture();
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("CustomObjects", () => {
  it("lists the registry and starts a detection", async () => {
    show();
    expect(within(await screen.findByTestId("z-registry")).getAllByRole("row").length).toBeGreaterThan(1);
    fireEvent.click(screen.getByRole("button", { name: "Detect now" }));
    expect(await screen.findByTestId("action-result")).toHaveTextContent("Detection started");
  });

  it("marks an anomaly as expected", async () => {
    const spy = vi.spyOn(sys, "feedbackZAnomaly");
    show("anomalies");
    fireEvent.click(await screen.findByRole("button", { name: "Mark ZZPACKVAR null_rate_spike as expected" }));
    expect(await screen.findByText("Marked as expected")).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith("za-1", "dismissed");
  });

  it("validates then creates a Z rule", async () => {
    const spy = vi.spyOn(sys, "createZRule");
    show("rules");
    const form = await screen.findByRole("form", { name: "New Z rule" });
    fireEvent.click(within(form).getByRole("button", { name: "Create Z rule" }));
    expect(within(form).getAllByRole("alert").map((a) => a.textContent)).toEqual(["Enter a rule name", "Enter the condition"]);
    expect(spy).not.toHaveBeenCalled();
    fireEvent.change(within(form).getByLabelText(/^Rule name/), { target: { value: "Pack variant set" } });
    fireEvent.change(within(form).getByLabelText(/^Condition/), { target: { value: "ZZPACKVAR is not blank" } });
    fireEvent.click(within(form).getByRole("button", { name: "Create Z rule" }));
    expect(await within(form).findByText("Z rule created")).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith({ rule_name: "Pack variant set", custom_condition: "ZZPACKVAR is not blank", severity: "medium" });
  });

  it("gates the actions on permission", async () => {
    allowed = false;
    show("anomalies");
    await screen.findByTestId("z-anomalies");
    expect(screen.queryByRole("button", { name: /as expected/ })).toBeNull();
    expect(screen.getByText("Marking an anomaly as expected or to investigate needs the AI feedback permission.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Detect now" })).toHaveAttribute("aria-disabled", "true");
  });

  it("shows the empty state", async () => {
    vi.spyOn(sys, "getZGhost").mockResolvedValue([]);
    show("ghost");
    expect(await screen.findByText("No ghost objects: every custom object in the latest analysis is used.")).toBeInTheDocument();
  });

  it("offers a retry when a list cannot be read", async () => {
    const spy = vi.spyOn(sys, "getZMapping").mockRejectedValue(new Error("down"));
    show("mapping");
    fireEvent.click(await screen.findByRole("button", { name: /Try again|Retry/ }, { timeout: 4000 }));
    await waitFor(() => expect(spy.mock.calls.length).toBeGreaterThan(1));
  });
});

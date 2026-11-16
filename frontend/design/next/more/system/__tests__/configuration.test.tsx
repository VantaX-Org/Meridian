import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { landscapeFixture, resetWorkFixture } from "@/lib/api/v2/fixtures";
import * as runs from "@/lib/api/v2/runs";
import { ToastProvider } from "../../../kit";
import { Configuration } from "../Configuration";

let allowed = true;
vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/lib/v2/hooks", async (orig) => ({ ...(await orig<object>()), useV2Session: () => ({ can: () => allowed, id: "me", name: "Me", email: "me@example.com", persona: "admin", label: "Admin", fixture: true, viewAs: null, shared: false }) }));

const [ECC] = landscapeFixture.systems;
const show = (part = "areas") => {
  setUrl(`/more/systems/${ECC.id}?fixture=1&tab=configuration&part=${part}`);
  return renderWithQuery(<ToastProvider><Configuration id={ECC.id} /></ToastProvider>);
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

describe("Configuration", () => {
  it("shows the load facts and the areas", async () => {
    show();
    expect(await screen.findByTestId("config-areas")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load again" })).toBeEnabled();
  });

  it("starts a configuration load and links the job", async () => {
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Load again" }));
    const result = await screen.findByTestId("action-result");
    expect(result).toHaveTextContent("Configuration load started");
  });

  it("says how much of the source was read live", async () => {
    show("source");
    await waitFor(() => expect(screen.getByTestId("config-source-summary")).toHaveTextContent("25 of 28 configuration objects were read live"));
    expect(within(await screen.findByTestId("spro-sources")).getAllByRole("row").length).toBeGreaterThan(1);
  });

  it("lists the drift log", async () => {
    show("drift");
    expect(within(await screen.findByTestId("config-drift")).getAllByRole("row")).toHaveLength(4);
  });

  it("proposes matches to the steward queue", async () => {
    show("compare");
    expect(await screen.findByTestId("compare-target")).toHaveTextContent("Compared with S/4HANA sandbox");
    fireEvent.click(screen.getByRole("button", { name: "Propose matches" }));
    expect(await screen.findByText("2 matches sent to the steward queue")).toBeInTheDocument();
  });

  it("disables the actions without permission", async () => {
    allowed = false;
    show("compare");
    expect(await screen.findByRole("button", { name: "Propose matches" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Loading the configuration needs the trigger sync permission; discovery needs analyse.")).toBeInTheDocument();
  });

  it("shows the empty state when nothing was loaded", async () => {
    vi.spyOn(runs, "getSystemConfigLoad").mockResolvedValue(null);
    show();
    expect(await screen.findByText("No configuration has been loaded from this system. Choose Load configuration to read it.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load configuration" })).toBeInTheDocument();
  });

  it("shows an error with retry", async () => {
    vi.spyOn(runs, "getSystemConfigLoad").mockRejectedValue(new Error("boom"));
    show();
    expect((await screen.findAllByText("The configuration status could not be read.")).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /try again|retry/i }).length).toBeGreaterThan(0);
  });
});

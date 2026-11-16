import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import * as api from "@/lib/api/v2/discovery";
import * as land from "@/lib/api/v2/landscape";
import { ToastProvider } from "../../../kit";
import { Processes } from "../Processes";

const Q = vi.hoisted(() => ({ can: (() => true) as (p: string) => boolean }));
vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/lib/v2/hooks", async (orig) => ({ ...(await orig<object>()), useV2Session: () => ({ can: Q.can, id: "me", name: "Me", email: "me@example.com", persona: "admin", label: "Admin", fixture: true, viewAs: null, shared: false }) }));

const entry = {
  l1: "O2C", name: "Order to cash", coverage: "full", reason: null, in_progress: false, failed: null, dq_defects: 3, licence_blocked: false, sources: [],
  last_run: { id: "r1", status: "done", finished_at: "2026-11-01T00:00:00Z", cases: 120, variants: 4, median_seconds: 3600, automation_rate: 0.5, fitness: 0.91 },
} as unknown as api.CatalogueEntry;

function mockAll() {
  vi.spyOn(land, "getLandscape").mockResolvedValue({ systems: [{ id: "s1", name: "ECC" }], objects: [] } as unknown as Awaited<ReturnType<typeof land.getLandscape>>);
  vi.spyOn(api, "getCatalogue").mockResolvedValue([entry]);
  vi.spyOn(api, "getDiscoveryHealth").mockResolvedValue([]);
  vi.spyOn(api, "getSchedules").mockResolvedValue([]);
}

const wrap = () => renderWithQuery(<ToastProvider><Processes /></ToastProvider>);
beforeEach(() => { Q.can = () => true; setUrl("/more?fixture=1"); window.sessionStorage.setItem("mn_v2_fixture", "1"); });
afterEach(() => { window.sessionStorage.clear(); vi.restoreAllMocks(); });

describe("Processes (native)", () => {
  it("renders the catalogue with the code beside its name", async () => {
    mockAll();
    wrap();
    expect((await screen.findByTestId("pd-catalogue")).textContent).toMatch(/O2C.*Order to cash/);
    expect(screen.getByTestId("pd-sch-add")).toBeInTheDocument();
  });

  it("starts a discovery run", async () => {
    mockAll();
    const start = vi.spyOn(api, "startDiscovery").mockResolvedValue({} as Awaited<ReturnType<typeof api.startDiscovery>>);
    wrap();
    fireEvent.click(await screen.findByTestId("pd-run-O2C"));
    await waitFor(() => expect(start).toHaveBeenCalledWith("s1", ["O2C"], "full"));
  });

  it("hides mining, schedules and export without the permissions", async () => {
    Q.can = () => false;
    mockAll();
    wrap();
    expect(await screen.findByTestId("pd-open-O2C")).toBeInTheDocument();
    expect(screen.queryByTestId("pd-run-O2C")).toBeNull();
    expect(screen.queryByTestId("pd-sch-add")).toBeNull();
    expect(screen.queryByTestId("pd-export-signavio")).toBeNull();
  });

  it("says a 403 cannot be read", async () => {
    mockAll();
    vi.spyOn(api, "getCatalogue").mockRejectedValue({ response: { status: 403 } });
    wrap();
    expect(await screen.findByText("Your role cannot read the process discovery data.")).toBeInTheDocument();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { SystemPage } from "../SystemPage";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/design/v2/screens/system/Configuration", () => ({ Configuration: () => <div data-testid="v-configuration" /> }));
vi.mock("@/design/v2/screens/system/CustomObjects", () => ({ CustomObjects: () => <div data-testid="v-custom" /> }));
vi.mock("@/design/v2/screens/system/SourceDesign", () => ({ SourceDesign: () => <div data-testid="v-design" /> }));
vi.mock("../system/Schedules", () => ({ Schedules: () => <div data-testid="v-schedules" /> }));
vi.mock("../system/Connectivity", () => ({ Connectivity: () => <div data-testid="n-connectivity" /> }));
vi.mock("../system/ProcessModel", () => ({ ProcessModel: () => <div data-testid="n-process" /> }));
vi.mock("../system/Mining", () => ({ Mining: () => <div data-testid="n-mining" /> }));
vi.mock("../system/ConfigChanges", () => ({ ConfigChanges: () => <div data-testid="v-changes" /> }));
vi.mock("../system/ChangeLog", () => ({ ChangeLog: ({ versionId }: { versionId: string }) => <div data-testid="v-changelog">{versionId}</div> }));

const ok = <T,>(data: T) => ({ data, isLoading: false, error: null, refetch: () => Promise.resolve() });
vi.mock("@/lib/v2/runs-queries", () => ({
  useSystemsExtended: () => ok([{ id: "s1", name: "Test system", system_type: "sap_ecc", environment: "dev", health_status: "healthy", health_message: null, host: "host.example", client: "100", last_sync_at: null }]),
  useSystemProfiles: () => ok([]),
  useSystemExtractions: () => ok({ versions: [
    { id: "v2", run_at: "2026-01-02T00:00:00Z", label: null, baseline: false, objects: ["MARA"], records: { MARA: 5 }, analysed_at: "2026-01-02T01:00:00Z", analysable: true, status: "done" },
    { id: "v1", run_at: "2026-01-01T00:00:00Z", label: "First", baseline: true, objects: ["MARA"], records: { MARA: 4 }, analysed_at: null, analysable: true, status: "done" },
  ] }),
  useV2Jobs: () => ({ jobs: [] }),
}));
vi.mock("@/lib/v2/queries", () => ({ useLandscape: () => ok({ systems: [{ id: "s1", name: "Test system", state: "extracted" }], cells: [{ system_id: "s1", module: "material_master", score: 81.2, verdict: "go", records_checked: 10 }], objects: [{ module: "material_master", label: "Material" }] }) }));

beforeEach(() => setUrl("/more/systems/s1?fixture=1"));

describe("SystemPage (next)", () => {
  it("keeps test, load or extract and connection settings as panel links", () => {
    renderWithQuery(<SystemPage id="s1" />);
    const hrefs = within(screen.getByTestId("system-actions")).getAllByRole("link").map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.some((h) => h.includes("open=system"))).toBe(true);
    expect(hrefs.some((h) => h.includes("open=connection"))).toBe(true);
    expect(within(screen.getByTestId("system-objects")).getByRole("link").getAttribute("href")).toContain("/o/");
  });

  it("opens an old ?tab= word on the same view", () => {
    setUrl("/more/systems/s1?tab=config&fixture=1");
    renderWithQuery(<SystemPage id="s1" />);
    expect(screen.getByTestId("v-configuration")).toBeTruthy();
  });

  it("lists every read with its run link and change log", () => {
    renderWithQuery(<SystemPage id="s1" />);
    fireEvent.click(screen.getByRole("radio", { name: "Reads" }));
    const list = screen.getByTestId("system-extractions");
    expect(within(list).getByRole("link", { name: "Open the run" }).getAttribute("href")).toContain("/run/v2");
    expect(screen.getByTestId("v-changelog").textContent).toBe("v2");
    fireEvent.click(within(list).getAllByRole("button", { name: /Change log/ })[1]);
    expect(screen.getByTestId("v-changelog").textContent).toBe("v1");
  });

  it("reaches schedules, custom objects, source design and changes", () => {
    renderWithQuery(<SystemPage id="s1" />);
    for (const [name, id] of [["Schedules", "v-schedules"], ["Custom objects", "v-custom"], ["Source design", "v-design"], ["Configuration changes", "v-changes"], ["Connectivity", "n-connectivity"], ["Process model", "n-process"], ["Mining", "n-mining"]] as const) {
      fireEvent.click(screen.getByRole("radio", { name }));
      expect(screen.getByTestId(id)).toBeTruthy();
    }
  });
});

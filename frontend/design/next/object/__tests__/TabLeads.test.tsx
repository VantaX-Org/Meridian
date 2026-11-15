import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { resetWorkFixture } from "@/lib/api/v2/fixtures";
import { ToastProvider } from "@/design/next/kit";
import { SheetHost } from "@/design/next/shell/SheetHost";
import { ObjectPage } from "@/design/next/screens/ObjectPage";
import type { TabId } from "../tabs";
import { getUrl, setUrl } from "@/design/v2/__tests__/nav-store";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

const SYS = "ecc-production";
const MOD = "material-master";

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetWorkFixture();
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.clearAllMocks();
});

function open(tab: TabId, opts: { system?: string; sub?: string; query?: string } = {}) {
  const system = opts.system ?? SYS;
  setUrl(`/next/o/${system}/${MOD}/${tab}${opts.sub ? `/${opts.sub}` : ""}?fixture=1${opts.query ?? ""}`);
  return renderWithQuery(
    <ToastProvider><SheetHost>
      <ObjectPage system={system} module={MOD} tab={tab} sub={opts.sub} />
    </SheetHost></ToastProvider>,
  );
}

const LED: TabId[] = ["records", "rules", "fixes", "trend", "readiness", "processes", "glossary", "golden", "lineage", "profile"];

describe("object segments lead with a chart", () => {
  for (const id of LED) {
    it(`${id} leads with a heading and a chart`, async () => {
      open(id);
      const lead = await screen.findByTestId(`lead-${id}`);
      expect(within(lead).getByRole("heading", { level: 2 })).toBeTruthy();
      expect(within(lead).getByTestId(`lead-chart-${id}`)).toBeTruthy();
    });
  }

  it("keeps what the old frame drew: related objects under every view, and the issues link on Overview", async () => {
    open("overview");
    const link = await screen.findByTestId("object-issues");
    expect(link.getAttribute("href")).toContain("/issues?module=material-master");
    expect(await screen.findByTestId("frame-head")).toBeTruthy();
  });
});

describe("object addresses", () => {
  it("resolves the any-system address to the system that holds the object", async () => {
    open("rules", { system: "_", query: "&run=abc" });
    await waitFor(() => expect(getUrl()).toMatch(/^\/next\/o\/(?!_\/)[^/]+\/material-master\/rules\?.*run=abc/));
  });

  it("turns the old as_of parameter into run", async () => {
    open("overview", { query: "&as_of=abc" });
    await waitFor(() => expect(getUrl()).toMatch(/run=abc/));
    expect(getUrl()).not.toMatch(/as_of=/);
  });

  it("opens one record under records/{key}", async () => {
    const key = encodeURIComponent("MATNR=000000000000000101");
    open("records", { sub: key });
    expect(await screen.findByTestId("record-canvas")).toBeTruthy();
    expect(screen.queryByTestId("lead-records")).toBeNull();
  });

  it("opens the process designer under processes/design", async () => {
    open("processes", { sub: "design" });
    expect((await screen.findAllByText(/process model|Changing the model/)).length).toBeGreaterThan(0);
    expect(screen.queryByTestId("lead-processes")).toBeNull();
  });
});

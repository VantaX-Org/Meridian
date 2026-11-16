import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import * as step9 from "@/lib/api/v2/step9";
import landscapeJson from "@/lib/api/v2/fixtures/landscape.json";
import runsJson from "@/lib/api/v2/fixtures/runs.json";
import type { Landscape, RunList } from "@/lib/api/v2/types";
import { ToastProvider } from "../../../kit";
import { ChangeLog } from "../ChangeLog";
import { ConfigChanges } from "../ConfigChanges";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/lib/v2/hooks", async (orig) => ({ ...(await orig<object>()), useV2Session: () => ({ can: () => true, id: "me", name: "Me", email: "me@example.com", persona: "admin", label: "Admin", fixture: true, viewAs: null, shared: false }) }));

const runs = (runsJson as unknown as RunList).versions;
const ECC = (landscapeJson as unknown as Landscape).systems[0];
const wrap = (el: ReactElement) => renderWithQuery(<ToastProvider>{el}</ToastProvider>);

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  setUrl("/more/systems");
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("Change log", () => {
  it("shows a delta download per table with the totals row", async () => {
    wrap(<ChangeLog versionId={runs[0].id} when={null} />);
    expect(await screen.findByTestId("change-log-line")).toHaveTextContent("Changes only since");
    const table = screen.getByRole("table");
    expect(within(table).getByText("MARA")).toBeInTheDocument();
    expect(within(table).getByText("All tables")).toBeInTheDocument();
    expect(within(table).getAllByText("Changes by date").length).toBeGreaterThan(0);
  });

  it("explains a full download that was not compared", async () => {
    wrap(<ChangeLog versionId={runs[1].id} when={null} />);
    expect(await screen.findByTestId("change-log-line")).toHaveTextContent("not compared with an earlier download");
  });

  it("shows the empty state for a download without a change log", async () => {
    vi.spyOn(step9, "getVersionChanges").mockResolvedValue({ version_id: "x", delta: null, tables: [], totals: { rows_read: 0, rows_total: 0, inserted: null, updated: null, deleted: null, unchanged: null, changed: null } });
    wrap(<ChangeLog versionId="x-empty" when={null} />);
    expect(await screen.findByText(/This download has no change log/)).toBeInTheDocument();
  });

  it("shows an error with retry", async () => {
    vi.spyOn(step9, "getVersionChanges").mockRejectedValue(new Error("boom"));
    wrap(<ChangeLog versionId="x-error" when={null} />);
    expect(await screen.findByText("The change log of this download could not be read.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
  });
});

describe("Configuration changes", () => {
  it("lists the drift alerts of the system with the rules touched", async () => {
    wrap(<ConfigChanges systemId={ECC.id} />);
    const items = await screen.findAllByTestId("drift-alert");
    expect(items.length).toBeGreaterThan(0);
    expect(within(items[0]).getByText("MM142")).toBeInTheDocument();
    expect(within(items[0]).getByText("Configuration sync")).toBeInTheDocument();
  });

  it("shows the empty state for a system without changes", async () => {
    wrap(<ConfigChanges systemId="no-such-system" />);
    expect(await screen.findByText(/No configuration change has been seen on this system/)).toBeInTheDocument();
  });

  it("shows an error with retry and recovers", async () => {
    const spy = vi.spyOn(step9, "getDriftAlerts").mockRejectedValue(new Error("boom"));
    wrap(<ConfigChanges systemId={ECC.id} />);
    expect(await screen.findByText("The configuration changes could not be read.")).toBeInTheDocument();
    spy.mockResolvedValue({ alerts: [] });
    fireEvent.click(screen.getByRole("button", { name: /try again|retry/i }));
    expect(await screen.findByText(/No configuration change has been seen on this system/)).toBeInTheDocument();
  });
});

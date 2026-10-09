import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import { ConfigLoadPanel } from "../config-load-panel";
import * as configLoadApi from "@/lib/api/config-load";
import type { ConfigLoad, LoadArea } from "@/lib/api/config-load";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/systems/sys1",
  useSearchParams: () => new URLSearchParams(),
}));

const area = (over: Partial<LoadArea>): LoadArea => ({
  area: "business_partner", label: "Business partner", status: "loaded",
  tables_total: 1, tables_done: 1, objects: [],
  ...over,
});

const load = (over: Partial<ConfigLoad> = {}): ConfigLoad => ({
  load_id: "l1", system_id: "sys1", system_type: "ecc", role: "steward", origin: "manual",
  status: "completed", error: null, created_at: "2026-01-01T00:00:00Z", finished_at: "2026-01-01T00:05:00Z",
  flows_derived: false, config_status: "loaded", areas: [], areas_loaded: 1, areas_total: 1, current_area: null,
  summary: { loaded: 2, empty: 0, failed: 0 }, objects: [], history: { source: null, table_logging_off: false, detail: "" },
  ...over,
});

describe("ConfigLoadPanel area rows", () => {
  it("links an area to its configuration table, not the area key (#390)", async () => {
    vi.spyOn(configLoadApi, "getConfigLoad").mockResolvedValue(load({
      areas: [area({
        area: "business_partner", label: "Business partner",
        objects: [{ object: "BUT000", label: "Business partners", state: "loaded", rows: 1234, detail: "", cause: null }],
      })],
    }));
    renderWithQuery(<ConfigLoadPanel systemId="sys1" systemType="ecc" canLoad={false} />);
    const link = await screen.findByRole("link", { name: "Business partner" });
    expect(link).toHaveAttribute("href", "/systems/sys1?tab=health&part=config&table=BUT000");
  });

  it("shows the per-area found counts, or the empty text when nothing was found (#390)", async () => {
    vi.spyOn(configLoadApi, "getConfigLoad").mockResolvedValue(load({
      areas: [
        area({
          area: "business_partner", label: "Business partner",
          objects: [
            { object: "BUT000", label: "company codes", state: "loaded", rows: 1234, detail: "", cause: null },
            { object: "T001W", label: "plants", state: "loaded", rows: 56, detail: "", cause: null },
          ],
        }),
        area({
          area: "controlling", label: "Controlling", status: "loaded",
          objects: [{ object: "CSKS", label: "cost centers", state: "empty", rows: 0, detail: "", cause: null }],
        }),
      ],
    }));
    renderWithQuery(<ConfigLoadPanel systemId="sys1" systemType="ecc" canLoad={false} />);
    expect(await screen.findByText(/^1.234 company codes, 56 plants$/)).toBeInTheDocument();
    expect(await screen.findByText("No controlling configuration found.")).toBeInTheDocument();
  });
});

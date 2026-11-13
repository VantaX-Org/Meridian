import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ExtractTargetStep, buildChoice, previewLine } from "../admin/ExtractTargetStep";
import { RunOutputCard, fillSummary } from "../inspector/RunOutputCard";

const mocks = vi.hoisted(() => ({
  can: true,
  systems: [
    { id: "src", name: "Source one", role: "source", target_system_id: "tgt" },
    { id: "tgt", name: "Target one", role: "target", target_system_id: null },
    { id: "tgt2", name: "Target two", role: "target", target_system_id: null },
  ] as unknown[],
  templates: {} as Record<string, { id: string; name: string; version: number; created_at: string }[]>,
  run: { target_system_id: "tgt", templates: [] } as unknown,
  open: vi.fn(async () => "f.xlsx"),
  refill: vi.fn(async () => ({})),
}));

vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("@/lib/v2/runs-queries", () => ({ useSystemsExtended: () => ({ data: mocks.systems }) }));
vi.mock("../admin/kit", async (orig) => ({ ...(await orig<object>()), useCan: () => () => mocks.can }));
vi.mock("@/lib/api/v2/migration", () => ({ getTemplates: async (m: string) => ({ module: m, templates: mocks.templates[m] ?? [] }) }));
vi.mock("@/lib/api/v2/extract-target", () => ({ getRunExtractTarget: async () => mocks.run, openExtractTargetFile: mocks.open, refillExtractTarget: mocks.refill }));

const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
const tpl = (id: string, name: string, at: string) => ({ id, name, version: 1, created_at: at });

beforeEach(() => {
  mocks.can = true;
  mocks.templates = { material_master: [tpl("old", "Material load", "2026-01-01"), tpl("new", "Material load v2", "2026-02-01")] };
  mocks.open.mockClear();
  mocks.refill.mockReset();
  mocks.refill.mockImplementation(async () => ({}));
});

describe("buildChoice", () => {
  it("sends nothing while every default holds", () => {
    expect(buildChoice("tgt", "tgt", {}, ["material_master"])).toBeUndefined();
  });
  it("sends a changed system, a picked template and an empty id for None, only for picked modules", () => {
    expect(buildChoice("tgt", "tgt2", { material_master: "old", gone: "x", customer_master: "" }, ["material_master", "customer_master"])).toEqual({
      target_system_id: "tgt2",
      target_template_ids: { material_master: "old", customer_master: "" },
    });
  });
});

describe("previewLine", () => {
  it("names each template and says so when there is none", () => {
    expect(previewLine([{ module: "material_master", name: "A" }, { module: "customer_master", name: null }])).toMatch(/^Will fill: A for /);
    expect(previewLine([{ module: "material_master", name: null }])).toBe("No template will be filled automatically.");
  });
});

describe("ExtractTargetStep", () => {
  it("defaults to the paired system and the newest template, and reports no override", async () => {
    const onChange = vi.fn();
    wrap(<ExtractTargetStep system="src" modules={["material_master"]} onChange={onChange} />);
    expect(await screen.findByTestId("extract-target-system")).toHaveValue("tgt");
    expect(screen.getByRole("option", { name: /Target one \(target system, paired\)/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("extract-target-tpl-material_master")).toHaveValue("new"));
    expect(screen.getByTestId("extract-target-preview").textContent).toContain("Material load v2");
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it("reports None as an empty template id and updates the preview", async () => {
    const onChange = vi.fn();
    wrap(<ExtractTargetStep system="src" modules={["material_master"]} onChange={onChange} />);
    const pick = await screen.findByTestId("extract-target-tpl-material_master");
    fireEvent.change(pick, { target: { value: "" } });
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({ target_template_ids: { material_master: "" } }));
    expect(screen.getByTestId("extract-target-preview").textContent).toBe("No template will be filled automatically.");
  });

  it("links to the template upload when an object has no template", async () => {
    wrap(<ExtractTargetStep system="src" modules={["customer_master"]} onChange={() => undefined} />);
    expect(await screen.findByTestId("extract-target-none-customer_master")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Upload a template" })).toBeInTheDocument();
  });

  it("explains when no target system is paired", async () => {
    mocks.systems = [{ id: "src", name: "Source one", role: "source", target_system_id: null }];
    wrap(<ExtractTargetStep system="src" modules={["material_master"]} onChange={() => undefined} />);
    expect(await screen.findByTestId("extract-target-nopair")).toBeInTheDocument();
    mocks.systems = [
      { id: "src", name: "Source one", role: "source", target_system_id: "tgt" },
      { id: "tgt", name: "Target one", role: "target", target_system_id: null },
      { id: "tgt2", name: "Target two", role: "target", target_system_id: null },
    ];
  });
});

describe("fillSummary", () => {
  it("counts rows and states the approved fixes left out as stale", () => {
    const s = fillSummary({ rows: 120, ready: 112, held: 8, cleansed: 14, stale_fixes: 2 });
    expect(s).toContain("120 rows");
    expect(s).toContain("2 approved fixes not applied because the value changed in the source");
  });
});

describe("RunOutputCard", () => {
  const filled = { module: "material_master", template_id: "new", template_name: "Material load v2", status: "filled", filled_at: "2026-02-02T10:00:00Z", summary: { rows: 3, stale_fixes: 1 }, download_url: "/x" };

  it("shows a filled module with its summary and downloads it", async () => {
    mocks.run = { target_system_id: "tgt", templates: [filled] };
    wrap(<RunOutputCard id="v1" />);
    expect(await screen.findByTestId("run-output-status-material_master")).toHaveTextContent("Filled");
    expect(screen.getByTestId("run-output-summary-material_master")).toHaveTextContent("1 approved fix not applied");
    fireEvent.click(screen.getByTestId("run-output-download-material_master"));
    await waitFor(() => expect(mocks.open).toHaveBeenCalledWith("v1", "material_master"));
  });

  it("hides Download and says why without the export permission", async () => {
    mocks.can = false;
    mocks.run = { target_system_id: "tgt", templates: [filled] };
    wrap(<RunOutputCard id="v1" />);
    expect(await screen.findByTestId("run-output-noexport-material_master")).toBeInTheDocument();
    expect(screen.queryByTestId("run-output-download-material_master")).toBeNull();
  });

  it("shows the error of a failed fill and the skip reason of a delta run", async () => {
    mocks.run = { target_system_id: "tgt", templates: [
      { module: "material_master", template_id: "new", status: "failed", error: "No mapped columns" },
      { module: "customer_master", template_id: "c", status: "skipped", error: "delta run; refill from full version" },
    ] };
    wrap(<RunOutputCard id="v1" />);
    expect(await screen.findByText("No mapped columns")).toBeInTheDocument();
    expect(screen.getByText("delta run; refill from full version")).toBeInTheDocument();
    expect(screen.getByTestId("run-output-status-customer_master")).toHaveTextContent("Skipped");
    expect(screen.queryByTestId("run-output-download-material_master")).toBeNull();
  });

  it("flags a template deleted after the run", async () => {
    mocks.templates = { material_master: [] };
    mocks.run = { target_system_id: "tgt", templates: [filled] };
    wrap(<RunOutputCard id="v1" />);
    expect(await screen.findByText(/this template has since been deleted/)).toBeInTheDocument();
  });

  it("refills a module from the newest full extraction", async () => {
    mocks.run = { target_system_id: "tgt", templates: [filled] };
    wrap(<RunOutputCard id="v1" />);
    fireEvent.click(await screen.findByTestId("run-output-refill-material_master"));
    await waitFor(() => expect(mocks.refill).toHaveBeenCalledWith("v1", "material_master"));
  });

  it("shows why a refill was refused while an extraction runs", async () => {
    mocks.refill.mockImplementation(async () => {
      throw { response: { status: 409, data: { detail: "An extraction of this system is still running. Refill when it has finished." } } };
    });
    mocks.run = { target_system_id: "tgt", templates: [{ module: "material_master", template_id: "new", status: "skipped", error: "delta run; refill from full version" }] };
    wrap(<RunOutputCard id="v1" />);
    fireEvent.click(await screen.findByTestId("run-output-refill-material_master"));
    expect(await screen.findByText("An extraction of this system is still running. Refill when it has finished.")).toBeInTheDocument();
  });

  it("hides Refill without the export permission", async () => {
    mocks.can = false;
    mocks.run = { target_system_id: "tgt", templates: [filled] };
    wrap(<RunOutputCard id="v1" />);
    await screen.findByTestId("run-output-noexport-material_master");
    expect(screen.queryByTestId("run-output-refill-material_master")).toBeNull();
  });

  it("renders nothing for a run without a target", async () => {
    mocks.run = { target_system_id: null, templates: [] };
    const { container } = wrap(<RunOutputCard id="v1" />);
    await waitFor(() => expect(container.querySelector("[data-testid=run-output]")).toBeNull());
  });
});

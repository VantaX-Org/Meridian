// frontend/hooks/__tests__/use-day-one.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { SAPSystemExtended } from "@/types/api";
import type { LandscapeConfigStatus } from "@/lib/api/config-load";
import type { Version } from "@/types/api";

const getSystems = vi.fn();
const getConfigLandscape = vi.fn();
const getVersions = vi.fn();
let permissions: string[] = ["manage_system", "upload"];

vi.mock("@/lib/api/connectivity", () => ({ getSystems: (...a: unknown[]) => getSystems(...a) }));
vi.mock("@/lib/api/config-load", () => ({ getConfigLandscape: (...a: unknown[]) => getConfigLandscape(...a) }));
vi.mock("@/lib/api/versions", () => ({ getVersions: (...a: unknown[]) => getVersions(...a) }));
vi.mock("@/context/auth-context", () => ({
  useAuth: () => ({ user: { id: "u1", email: "a@b.com", name: "A", role: "admin", permissions } }),
}));

import { useDayOne } from "../use-day-one";

const system = (overrides: Partial<SAPSystemExtended> = {}): SAPSystemExtended =>
  ({ id: "s1", config_sync_status: "loaded", health_status: "healthy", ...overrides }) as SAPSystemExtended;
const landscape = (overrides: Partial<LandscapeConfigStatus> = {}): LandscapeConfigStatus =>
  ({ systems: [], counts: {}, loaded: 1, total: 1, ...overrides }) as unknown as LandscapeConfigStatus;
const version = (status: string, id = "v1"): Version => ({ id, run_at: "2026-01-01", label: null, status, dqs_summary: null, metadata: null }) as Version;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function run() {
  const { result } = renderHook(() => useDayOne(), { wrapper });
  await waitFor(() => expect(result.current.status).not.toBe("loading"));
  return result.current;
}

describe("useDayOne", () => {
  beforeEach(() => {
    permissions = ["manage_system", "upload"];
    getSystems.mockReset();
    getConfigLandscape.mockReset();
    getVersions.mockReset();
  });

  it("a finished run exists → ready, no step", async () => {
    getSystems.mockResolvedValue([system()]);
    getConfigLandscape.mockResolvedValue(landscape());
    getVersions.mockResolvedValue({ versions: [version("complete")] });
    const { status, step } = await run();
    expect(status).toBe("ready");
    expect(step).toBeNull();
  });

  it("a run failed and nothing else is running → step failed", async () => {
    getSystems.mockResolvedValue([system()]);
    getConfigLandscape.mockResolvedValue(landscape());
    getVersions.mockResolvedValue({ versions: [version("failed", "v2")] });
    const { step } = await run();
    expect(step?.key).toBe("failed");
    expect(step?.href).toBe("/runs/v2");
  });

  it("a run is in progress → step running", async () => {
    getSystems.mockResolvedValue([system()]);
    getConfigLandscape.mockResolvedValue(landscape());
    getVersions.mockResolvedValue({ versions: [version("running", "v3")] });
    const { step } = await run();
    expect(step?.key).toBe("running");
    expect(step?.href).toBe("/runs/v3");
  });

  it("no systems connected → step connect", async () => {
    getSystems.mockResolvedValue([]);
    getConfigLandscape.mockResolvedValue(landscape({ loaded: 0, total: 0 }));
    getVersions.mockResolvedValue({ versions: [] });
    const { step } = await run();
    expect(step?.key).toBe("connect");
  });

  it("system connected but configuration not loaded → step config", async () => {
    getSystems.mockResolvedValue([system({ config_sync_status: "not_loaded" })]);
    getConfigLandscape.mockResolvedValue(landscape({ loaded: 0, total: 1 }));
    getVersions.mockResolvedValue({ versions: [] });
    const { step } = await run();
    expect(step?.key).toBe("config");
  });

  it("system connected and configured but never extracted → step extract", async () => {
    getSystems.mockResolvedValue([system({ config_sync_status: "loaded" })]);
    getConfigLandscape.mockResolvedValue(landscape({ loaded: 1, total: 1 }));
    getVersions.mockResolvedValue({ versions: [] });
    const { step } = await run();
    expect(step?.key).toBe("extract");
  });

  it("gates the step label for a viewer without manage_system", async () => {
    permissions = [];
    getSystems.mockResolvedValue([]);
    getConfigLandscape.mockResolvedValue(landscape({ loaded: 0, total: 0 }));
    getVersions.mockResolvedValue({ versions: [] });
    const { step } = await run();
    expect(step?.label).toBe("Ask an administrator to connect a system.");
    // A gated step has no destination — callers must render it as text, never a link.
    expect(step?.actionable).toBe(false);
    expect(step?.href).toBeNull();
  });

  it("a run in progress stays actionable even for a viewer without manage_system", async () => {
    permissions = [];
    getSystems.mockResolvedValue([system()]);
    getConfigLandscape.mockResolvedValue(landscape());
    getVersions.mockResolvedValue({ versions: [version("running", "v3")] });
    const { step } = await run();
    expect(step?.key).toBe("running");
    expect(step?.actionable).toBe(true);
    expect(step?.href).toBe("/runs/v3");
  });

  it("surfaces an API error as status error", async () => {
    getSystems.mockRejectedValue(new Error("boom"));
    getConfigLandscape.mockResolvedValue(landscape());
    getVersions.mockResolvedValue({ versions: [] });
    const { result } = renderHook(() => useDayOne(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("error"));
  });
});

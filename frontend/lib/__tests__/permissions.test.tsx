// frontend/lib/__tests__/permissions.test.tsx
import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as meApi from "@/lib/api/me";
import * as connectivityApi from "@/lib/api/connectivity";
import apiClient from "@/lib/api/client";
import { Can, PermissionsProvider, usePermissions } from "@/lib/permissions";
import { RequestAccessDialog } from "@/components/request-access-dialog";
import { ScopedPill } from "@/components/scoped-pill";
import { GatedPrimary, primaryTooltip } from "@/components/gated-primary";
import { inSystems } from "@/lib/run-scope";
import type { Version } from "@/types/api";
import { permissionsPayload } from "../../e2e/fixtures/legacy-permissions";

afterEach(() => vi.restoreAllMocks());

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const steward = permissionsPayload("steward");
const viewer = permissionsPayload("viewer");
const scoped: meApi.EffectivePermissions = {
  ...permissionsPayload("analyst"),
  roles: [{ key: "analyst", name: "Analyst", system_id: "s1", module: "material_master" }],
  scopes: [{ system_id: "s1", module: "material_master" }],
};

describe("<Can>", () => {
  it("renders children when the pair is granted", async () => {
    vi.spyOn(meApi, "getMyPermissions").mockResolvedValue(steward);
    wrap(<PermissionsProvider><Can resource="fixes" action="approve">approve</Can></PermissionsProvider>);
    expect(await screen.findByText("approve")).toBeInTheDocument();
  });

  it("renders nothing when the pair is not granted", async () => {
    const get = vi.spyOn(meApi, "getMyPermissions").mockResolvedValue(viewer);
    wrap(<PermissionsProvider><Can resource="fixes" action="approve">approve</Can><span>ready</span></PermissionsProvider>);
    await waitFor(() => expect(get).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByText("approve")).not.toBeInTheDocument();
  });

  it("narrows with ?system_id=&module= when scope is passed", async () => {
    const get = vi.spyOn(meApi, "getMyPermissions").mockImplementation(async (q) => (q?.system_id === "s1" ? steward : viewer));
    wrap(
      <PermissionsProvider>
        <Can resource="fixes" action="approve" scope={{ system_id: "s1", module: "material_master" }}>in s1</Can>
        <Can resource="fixes" action="approve" scope={{ system_id: "s2" }}>in s2</Can>
      </PermissionsProvider>,
    );
    expect(await screen.findByText("in s1")).toBeInTheDocument();
    expect(screen.queryByText("in s2")).not.toBeInTheDocument();
    expect(get).toHaveBeenCalledWith({ system_id: "s1", module: "material_master" });
  });

  it("fails closed while /me/permissions loads", () => {
    vi.spyOn(meApi, "getMyPermissions").mockReturnValue(new Promise(() => {}));
    function Probe() {
      const p = usePermissions();
      return <span>{`${p.loading}:${p.can("view")}`}</span>;
    }
    wrap(<PermissionsProvider><Can resource="systems" action="view">visible</Can><Probe /></PermissionsProvider>);
    expect(screen.queryByText("visible")).not.toBeInTheDocument();
    expect(screen.getByText("true:false")).toBeInTheDocument();
  });
});

/** Make apiClient answer one request with a scoped 403 (the nested body from rbac.py). */
function forbidden(config: InternalAxiosRequestConfig): Promise<never> {
  const data = { detail: { detail: "forbidden", resource: "fixes", action: "approve", request_access: true } };
  return Promise.reject(new AxiosError("Forbidden", "ERR_BAD_REQUEST", config, null, {
    status: 403, statusText: "Forbidden", data, headers: {}, config: { ...config, headers: new AxiosHeaders() },
  }));
}

describe("403 handler", () => {
  it("opens the request Dialog for a user-initiated request", async () => {
    vi.spyOn(meApi, "getMyPermissions").mockResolvedValue(viewer);
    wrap(<PermissionsProvider><span /></PermissionsProvider>);
    await act(async () => {
      await apiClient.post("/api/v1/fix/batches/b1/approve", {}, { adapter: forbidden }).catch(() => {});
    });
    expect(await screen.findByRole("dialog", { name: "Request access" })).toBeInTheDocument();
    expect(screen.getByText("fixes")).toBeInTheDocument();
    expect(screen.getByText("approve")).toBeInTheDocument();
  });

  it("does not open it for a background GET", async () => {
    vi.spyOn(meApi, "getMyPermissions").mockResolvedValue(viewer);
    wrap(<PermissionsProvider><span /></PermissionsProvider>);
    await act(async () => {
      await apiClient.get("/api/v1/fix/batches", { adapter: forbidden }).catch(() => {});
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("RequestAccessDialog", () => {
  const target = { resource: "fixes", action: "approve", system_id: "s1", systemLabel: "ECC Prod" };

  it("submits the pair, scope and reason", async () => {
    const create = vi.spyOn(meApi, "createAccessRequest").mockResolvedValue({} as meApi.AccessRequest);
    const onClose = vi.fn();
    wrap(<RequestAccessDialog target={target} onClose={onClose} />);
    expect(screen.getByText("ECC Prod, all modules")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Wave 2 sign-off" } });
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(create).toHaveBeenCalledWith({
      resource: "fixes", action: "approve", system_id: "s1", module: null, reason: "Wave 2 sign-off",
    });
  });

  it("shows the API's 422 message", async () => {
    const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig;
    vi.spyOn(meApi, "createAccessRequest").mockRejectedValue(new AxiosError("422", "ERR_BAD_REQUEST", config, null, {
      status: 422, statusText: "Unprocessable", headers: {}, config,
      data: { detail: "Unknown or ungrantable resource/action" },
    }));
    wrap(<RequestAccessDialog target={{ resource: "licence", action: "view" }} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unknown or ungrantable resource/action");
  });
});

describe("GatedPrimary", () => {
  it("renders disabled with the role tooltip, and Request access opens the Dialog", async () => {
    vi.spyOn(meApi, "getMyPermissions").mockResolvedValue(viewer);
    wrap(<PermissionsProvider><GatedPrimary kind="approve" allowed={false} systemId="s1" scopeLabel="ECC Prod">Approve</GatedPrimary></PermissionsProvider>);
    const btn = await screen.findByRole("button", { name: /^Approve\./ });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAccessibleName(`Approve. ${primaryTooltip("approve", "ECC Prod")}`);
    expect(primaryTooltip("approve", "ECC Prod")).toBe("Needs Data owner on ECC Prod — Request access");
    fireEvent.click(screen.getByRole("button", { name: "Request access" }));
    expect(await screen.findByRole("dialog", { name: "Request access" })).toBeInTheDocument();
  });

  it("renders the plain button when allowed", () => {
    wrap(<GatedPrimary kind="extract" allowed>Extract now</GatedPrimary>);
    expect(screen.getByRole("button", { name: "Extract now" })).toBeEnabled();
  });
});

describe("inSystems", () => {
  const v = (id: string, system_id?: string) => ({ id, run_at: "2026-10-01T00:00:00Z", label: id, status: "complete", dqs_summary: null, metadata: system_id ? { system_id } : {} }) as Version;
  const runs = [v("r1", "s1"), v("r2", "s2"), v("u1")];
  it("keeps every run when unscoped", () => {
    expect(inSystems(runs, null)).toEqual(runs);
  });
  it("keeps only runs on in-scope systems", () => {
    expect(inSystems(runs, new Set(["s1"])).map((r) => r.id)).toEqual(["r1"]);
  });
});

describe("ScopedPill", () => {
  it("shows the first scope for a scoped user", async () => {
    vi.spyOn(meApi, "getMyPermissions").mockResolvedValue(scoped);
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([{ id: "s1", name: "ECC Prod" }] as Awaited<ReturnType<typeof connectivityApi.getSystems>>);
    wrap(<PermissionsProvider><ScopedPill /></PermissionsProvider>);
    expect(await screen.findByText(/^Scoped: ECC Prod, /)).toBeInTheDocument();
  });

  it("shows nothing for an unscoped user", async () => {
    const get = vi.spyOn(meApi, "getMyPermissions").mockResolvedValue(steward);
    wrap(<PermissionsProvider><ScopedPill /></PermissionsProvider>);
    await waitFor(() => expect(get).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByText(/Scoped:/)).not.toBeInTheDocument();
  });
});

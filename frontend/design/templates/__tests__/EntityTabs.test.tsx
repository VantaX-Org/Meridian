vi.mock("../../../hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AxiosError, type AxiosResponse } from "axios";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as auditApi from "@/lib/api/audit";
import { EntityTabs, entityTabs } from "../EntityTabs";


function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

afterEach(() => vi.restoreAllMocks());

describe("entityTabs", () => {
  it("returns related, history, audit, export and honours skip", () => {
    const all = entityTabs({ entityType: "rules", entityId: "1" }).map((t) => t.value);
    expect(all).toEqual(["related", "history", "audit", "export"]);
    expect(entityTabs({ entityType: "rules", entityId: "1", skip: ["history"] }).map((t) => t.value)).not.toContain("history");
  });

  it("leaves out the Export tab when canExport is false", () => {
    const v = entityTabs({ entityType: "rules", entityId: "1", canExport: false }).map((t) => t.value);
    expect(v).toEqual(["related", "history", "audit"]);
  });
});

describe("EntityTabs", () => {
  it("shows overview first and designed empty states on the others", async () => {
    const spy = vi.spyOn(auditApi, "getAuditEntries").mockResolvedValue({ entries: [], total: 0, limit: 100, offset: 0 });
    wrap(<EntityTabs entityType="systems" entityId="5" overview={<p>overview body</p>} />);
    expect(screen.getByText("overview body")).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("tab", { name: "History" }));
    expect(await screen.findByText("No history to show")).toBeInTheDocument();
  });

  it("audit tab filters by entity id when the id is numeric or a UUID", async () => {
    const getAuditEntries = vi.spyOn(auditApi, "getAuditEntries");
    getAuditEntries.mockResolvedValue({ entries: [], total: 0, limit: 100, offset: 0 });
    wrap(<EntityTabs entityType="systems" entityId="42" overview={<p>o</p>} />);
    await userEvent.click(screen.getByRole("tab", { name: "Audit" }));
    await waitFor(() => expect(getAuditEntries).toHaveBeenCalledWith({ entity_type: "systems", entity_id: "42", limit: 100 }));
    expect(await screen.findByText("No changes recorded")).toBeInTheDocument();
  });

  it("audit tab falls back to a path filter for non-id keys", async () => {
    const getAuditEntries = vi.spyOn(auditApi, "getAuditEntries");
    getAuditEntries.mockResolvedValue({ entries: [], total: 0, limit: 100, offset: 0 });
    wrap(<EntityTabs entityType="objects" entityId="material_master" overview={<p>o</p>} />);
    await userEvent.click(screen.getByRole("tab", { name: "Audit" }));
    await waitFor(() => expect(getAuditEntries).toHaveBeenCalledWith({ entity_type: "objects", path_contains: "material_master", limit: 100 }));
  });

  it("audit tab matches nested resources on auditPath even when the id is a UUID", async () => {
    const getAuditEntries = vi.spyOn(auditApi, "getAuditEntries");
    getAuditEntries.mockResolvedValue({ entries: [], total: 0, limit: 100, offset: 0 });
    const id = "3f2b8c1e-0000-4000-8000-000000000001";
    wrap(<EntityTabs entityType="migration" entityId={id} auditPath={`/migration/waves/${id}`} overview={<p>o</p>} />);
    await userEvent.click(screen.getByRole("tab", { name: "Audit" }));
    await waitFor(() => expect(getAuditEntries).toHaveBeenCalledWith({ path_contains: `/migration/waves/${id}`, limit: 100 }));
  });

  it("export tab renders the options it is given instead of the empty state", async () => {
    wrap(<EntityTabs entityType="rules" entityId="42" overview={<p>o</p>} exportOptions={[{ format: "xlsx", run: async () => {} }]} />);
    await userEvent.click(screen.getByRole("tab", { name: "Export" }));
    expect(screen.queryByText("Nothing to export here")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
  });

  it("audit tab shows a restricted state on 403", async () => {
    const getAuditEntries = vi.spyOn(auditApi, "getAuditEntries");
    getAuditEntries.mockRejectedValue(new AxiosError("no", "ERR", undefined, undefined, { status: 403 } as AxiosResponse));
    wrap(<EntityTabs entityType="systems" entityId="42" overview={<p>o</p>} />);
    await userEvent.click(screen.getByRole("tab", { name: "Audit" }));
    expect(await screen.findByText("Audit history is restricted")).toBeInTheDocument();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import type { ProcessModelDocument } from "@/types/process-model";
import { ToastProvider } from "../../../kit";
import type { ObjectRun } from "../../useObjectRun";
import { ProcessDesigner } from "../ProcessDesigner";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

vi.mock("@/lib/v2/hooks", async (orig) => ({ ...(await orig<object>()), useV2Session: () => ({ can: () => true, id: "me", name: "Me", email: "me@example.com", persona: "admin", label: "Admin", fixture: true, viewAs: null, shared: false }) }));

const Q = vi.hoisted(() => ({ models: [] as unknown[], fail: false, saved: null as unknown }));
vi.mock("@/lib/api/v2/designer", async (orig) => ({
  ...(await orig<object>()),
  listModels: () => (Q.fail ? Promise.reject(new Error("down")) : Promise.resolve(Q.models)),
  getModel: (id: string) => Promise.resolve({ model: { id, name: "Base", status: "draft", current_version: 1, updated_at: "2026-06-01T00:00:00Z" }, version_no: 1, document: { schema_version: 1, l1: [{ id: "p1", name: "Procure", description: "", order: 0, modules: [], l2: [] }] } }),
  listVersions: () => Promise.resolve([{ version_no: 1, note: "first", created_by: "a", created_at: "2026-06-01T00:00:00Z" }]),
  saveModel: (_id: string, body: { document: ProcessModelDocument }) => {
    Q.saved = body;
    return Promise.resolve({ model: { id: "m1", name: "Base", status: "draft", current_version: 2, updated_at: "2026-06-02T00:00:00Z" }, version_no: 2, warnings: [] });
  },
}));

const o = { label: "Material master", systemSeg: "ecc", moduleSeg: "material-master" } as unknown as ObjectRun;
const wrap = () => renderWithQuery(<ToastProvider><ProcessDesigner o={o} /></ToastProvider>);

beforeEach(() => {
  setUrl("/more/aletheia?fixture=1");
  Q.fail = false;
  Q.saved = null;
  Q.models = [{ id: "m1", name: "Base", status: "draft", current_version: 1, updated_at: "2026-06-01T00:00:00Z" }];
});

describe("ProcessDesigner", () => {
  it("loads the model and its tree", async () => {
    wrap();
    expect(await screen.findByText("Procure")).toBeTruthy();
    expect(screen.getByLabelText("Process tree")).toBeTruthy();
  });

  it("says so when no model exists", async () => {
    Q.models = [];
    wrap();
    expect(await screen.findByText(/No process model exists yet/)).toBeTruthy();
  });

  it("offers a retry when the models cannot be read", async () => {
    Q.fail = true;
    wrap();
    const retry = await screen.findByRole("button", { name: /try again|retry/i });
    Q.fail = false;
    fireEvent.click(retry);
    expect(await screen.findByText("Procure")).toBeTruthy();
  });

  it("adds a node and saves a new version", async () => {
    wrap();
    await screen.findByText("Procure");
    fireEvent.click(screen.getByRole("button", { name: "Procure" }));
    fireEvent.change(screen.getByLabelText(/^New /), { target: { value: "Buy" } });
    fireEvent.click(screen.getByRole("button", { name: /^Add (?!a process)/ }));
    expect(await screen.findByText("Buy")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save as a new version" }));
    await waitFor(() => expect(Q.saved).not.toBeNull());
    expect(JSON.stringify(Q.saved)).toContain("Buy");
  });
});

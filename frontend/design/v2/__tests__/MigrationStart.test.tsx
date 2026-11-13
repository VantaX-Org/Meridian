import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import landscape from "@/lib/api/v2/fixtures/landscape.json";
import * as migrationApi from "@/lib/api/v2/migration";
import { releaseFor } from "@/lib/api/v2/migration";
import type { VersionHead } from "@/lib/api/v2/runs";
import { completeRuns, StartForm } from "../screens/Migration";
import { ToastProvider } from "../Toast";
import { stubLayout } from "./layout-stub";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

const ECC = landscape.systems[0].id;

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  setUrl("/migration");
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("releaseFor", () => {
  it("loads ECC-type systems into the ECC dictionary and the rest into S/4HANA", () => {
    expect(releaseFor("ecc")).toBe("ecc6");
    expect(releaseFor("ewms")).toBe("ecc6");
    expect(releaseFor("s4hana_onprem")).toBe("s4hana");
    expect(releaseFor("s4hana_cloud")).toBe("s4hana");
    expect(releaseFor(null)).toBe("s4hana");
  });
});

describe("completeRuns", () => {
  it("keeps the complete runs, newest first", () => {
    const v = (id: string, status: string, run_at: string) => ({ id, status, run_at }) as VersionHead;
    const out = completeRuns([v("a", "complete", "2026-11-01T00:00:00Z"), v("b", "failed", "2026-11-03T00:00:00Z"), v("c", "agents_complete", "2026-11-02T00:00:00Z")]);
    expect(out.map((x) => x.id)).toEqual(["c", "a"]);
  });
});

describe("Start an analysis", () => {
  it("offers the source system's complete runs, picks the latest, and sends the chosen run", async () => {
    const start = vi.spyOn(migrationApi, "startMigration").mockResolvedValue({ run_id: "mig-9", task_id: null, status: "pending" } as unknown as Awaited<ReturnType<typeof migrationApi.startMigration>>);
    renderWithQuery(<ToastProvider><StartForm onDone={() => undefined} initialSystem={ECC} /></ToastProvider>);
    const picker = await screen.findByTestId("mig-start-version");
    await waitFor(() => expect(within(picker).getAllByRole("option").length).toBeGreaterThan(1));
    const options = within(picker).getAllByRole("option") as HTMLOptionElement[];
    expect(options[0].textContent).toMatch(/\(latest\)/);
    expect((picker as HTMLSelectElement).value).toBe(options[0].value);
    fireEvent.change(picker, { target: { value: options[1].value } });
    const form = picker.closest("form") as HTMLFormElement;
    fireEvent.click(within(form).getAllByRole("checkbox")[0]);
    fireEvent.click(within(form).getByRole("button", { name: "Start" }));
    await waitFor(() => expect(start).toHaveBeenCalled());
    expect(start.mock.calls[0][0]).toMatchObject({ source_system_id: ECC, source_version_id: options[1].value, target_release: "s4hana" });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderScreen } from "../test-utils";
import { stubLayout } from "@/design/v2/__tests__/layout-stub";
import { MoveLoad } from "./MoveLoad";
import { PLAN, RUN, route } from "./move-fixture";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/lib/api/client", async (orig) => {
  const m = await orig<typeof import("@/lib/api/client")>();
  const mk = () => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() });
  return { ...m, default: mk(), uploadApiClient: mk() };
});

let undo: () => void = () => undefined;
beforeEach(() => {
  undo = stubLayout();
  window.history.replaceState(null, "", "/load/move");
});
afterEach(() => undo());

const B = "/api/v1/migration/move";

describe("MoveLoad", () => {
  it("starts with a dry run", async () => {
    const calls = route({ [`GET ${B}/plans/p1`]: PLAN, [`POST ${B}/plans/p1/runs`]: RUN });
    const onRun = vi.fn();
    renderScreen(<MoveLoad planId="p1" runId={null} onRun={onRun} onBack={() => undefined} onNext={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "Run a dry run" }));
    await waitFor(() => expect(onRun).toHaveBeenCalledWith("r1"));
    expect(calls.find((c) => c.key.endsWith("/runs"))?.body).toEqual({ dry_run: true });
  });

  it("offers the cleansing log in cleansed mode", async () => {
    route({ [`GET ${B}/plans/p1`]: PLAN, [`GET ${B}/runs/r1`]: RUN });
    renderScreen(<MoveLoad planId="p1" runId="r1" onRun={() => undefined} onBack={() => undefined} onNext={() => undefined} />);
    expect(await screen.findByRole("button", { name: "Download cleansing log (CSV)" })).toBeTruthy();
  });

  it("offers the real load only after a passed dry run, behind a confirm", async () => {
    const calls = route({
      [`GET ${B}/plans/p1`]: PLAN,
      [`GET ${B}/runs/r1`]: RUN,
      [`POST ${B}/plans/p1/runs`]: { ...RUN, id: "r2", dry_run: false },
    });
    const onRun = vi.fn();
    renderScreen(<MoveLoad planId="p1" runId="r1" onRun={onRun} onBack={() => undefined} onNext={() => undefined} />);
    expect(await screen.findByText("Dry run passed")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry failed" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Load into New S4" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Load into New S4?");
    expect(calls.some((c) => c.body && (c.body as { dry_run?: boolean }).dry_run === false)).toBe(false);
    const confirm = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Load into New S4");
    fireEvent.click(confirm as HTMLElement);
    await waitFor(() => expect(onRun).toHaveBeenCalledWith("r2"));
    expect(calls.some((c) => (c.body as { dry_run?: boolean } | undefined)?.dry_run === false)).toBe(true);
  });
});

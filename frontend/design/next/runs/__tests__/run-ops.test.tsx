import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { ToastProvider } from "../../kit";
import { RunOps, eventSummary } from "../RunOps";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

const Q = vi.hoisted(() => ({ can: (() => true) as (a: string) => boolean }));
vi.mock("@/lib/v2/hooks", async (orig) => ({ ...(await orig<object>()), useV2Session: () => ({ can: Q.can, id: "me", name: "Me", email: "me@example.com", persona: "admin", label: "Admin", fixture: true, viewAs: null, shared: false }) }));

const RUN = "d3229ded-0708-4967-9dfb-1b7f4fada953";
const wrap = (status = "complete", label: string | null = null) =>
  renderWithQuery(<ToastProvider><RunOps id={RUN} label={label} status={status} /></ToastProvider>);

beforeEach(() => {
  setUrl(`/runs/${RUN}?fixture=1`);
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  Q.can = () => true;
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
});

describe("Run actions (next)", () => {
  it("names the run", async () => {
    wrap();
    const save = screen.getByRole("button", { name: "Save name" }) as HTMLButtonElement;
    expect(save.disabled || save.getAttribute("aria-disabled") === "true").toBe(true);
    fireEvent.change(screen.getByPlaceholderText("Name this run"), { target: { value: "Year-end baseline" } });
    fireEvent.submit(screen.getByTestId("run-rename"));
    await waitFor(() => expect(screen.getByText("Run named Year-end baseline")).toBeTruthy());
  });

  it("re-runs the agents on a finished run and downloads every object's summary", async () => {
    wrap();
    fireEvent.click(screen.getByRole("button", { name: "Re-run agents" }));
    await waitFor(() => expect(screen.getByText("Agents started. The agents are reading this run's findings again.")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Download every object's summary" }));
    await waitFor(() => expect(screen.getByText("Every object's summary is downloaded.")).toBeTruthy());
  });

  it("holds the agents back while the run is still going and listens for its events", () => {
    wrap("running");
    const agents = screen.getByRole("button", { name: /Re-run agents/ }) as HTMLButtonElement;
    expect(agents.disabled || agents.getAttribute("aria-disabled") === "true").toBe(true);
    expect(screen.getByTestId("run-events")).toBeTruthy();
  });

  it("gates renaming and agents on analyse, and downloading on export", () => {
    Q.can = () => false;
    wrap();
    expect(screen.getByText("Pinning, archiving, restoring, renaming and re-running agents need the analyse permission.")).toBeTruthy();
    expect(screen.getByText("Downloading needs the export permission.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Download every object's summary" })).toBeNull();
    expect((screen.getByPlaceholderText("Name this run") as HTMLInputElement).disabled).toBe(true);
  });

  it("summarises an event payload as name and value pairs", () => {
    expect(eventSummary({ phase_name: "rules", progress: 40, empty: "" })).toBe("phase name rules, progress 40");
    expect(eventSummary("done")).toBe("done");
    expect(eventSummary(null)).toBe("");
  });
});

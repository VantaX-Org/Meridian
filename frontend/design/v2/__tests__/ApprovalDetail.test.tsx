import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { fixtureResponse } from "@/lib/api/v2/fixtures";
import { StepDecide } from "../inspector/decide";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  setUrl("/requests?fixture=1");
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("Approval detail", () => {
  it("answers one instance with its steps and trail, and 404 for an unknown one", async () => {
    const one = (await fixtureResponse("/workflows/instances/WI-1001", {})) as { tasks: unknown[]; history: unknown[]; object_id: string };
    expect(one.object_id).toBe("CR-1001");
    expect(one.tasks.length).toBeGreaterThan(0);
    expect(one.history.length).toBeGreaterThan(0);
    await expect(Promise.resolve().then(() => fixtureResponse("/workflows/instances/nope", {}))).rejects.toBeTruthy();
  });

  it("shows steps and audit trail after Show approval detail", async () => {
    renderWithQuery(<StepDecide kind="change_request" id="CR-1001" />);
    fireEvent.click(await screen.findByText("Show approval detail"));
    expect(await screen.findByTestId("approval-steps")).toBeTruthy();
    expect(screen.getByTestId("approval-trail").textContent).toContain("step skipped");
  });
});

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StepFlow, type FlowStep } from "./StepFlow";

const mk = (over: Partial<FlowStep> = {}, run?: () => Promise<unknown>): FlowStep[] => [
  { id: "a", label: "First", body: <p>one</p>, ...over },
  { id: "b", label: "Second", body: <p>two</p>, next: { label: "Go", run } },
];

describe("StepFlow", () => {
  it("counts steps, goes next and back", async () => {
    render(<StepFlow steps={mk()} label="job" />);
    expect(screen.getByTestId("flow-count").textContent).toBe("Step 1 of 2");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByTestId("flow-step-b")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(screen.getByTestId("flow-step-a")).toBeTruthy());
  });
  it("holds a blocked step and says why", () => {
    render(<StepFlow steps={mk({ blocked: "Enter a name." })} label="job" />);
    expect(screen.getAllByText("Enter a name.")[0]).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByTestId("flow-step-a")).toBeTruthy();
  });
  it("resumes at the initial step", () => {
    render(<StepFlow steps={mk()} label="job" initial={1} />);
    expect(screen.getByTestId("flow-step-b")).toBeTruthy();
  });
  it("stays on the step and shows the error when the action throws, then finishes", async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error("No logon.")).mockResolvedValue(undefined);
    const done = vi.fn();
    render(<StepFlow steps={mk({}, run)} label="job" initial={1} onFinish={done} />);
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect((await screen.findByRole("alert")).textContent).toBe("No logon.");
    expect(done).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    await waitFor(() => expect(done).toHaveBeenCalled());
  });
});

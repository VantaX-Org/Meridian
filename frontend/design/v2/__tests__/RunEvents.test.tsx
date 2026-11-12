import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as ops from "@/lib/api/v2/run-ops";
import { RunEvents } from "../screens/RunEvents";

afterEach(() => vi.restoreAllMocks());

describe("Run events", () => {
  let push: (e: ops.RunEvent) => void;
  let end: (err?: unknown) => void;
  const stop = vi.fn();
  beforeEach(() => {
    stop.mockClear();
    vi.spyOn(ops, "streamRunEvents").mockImplementation((_id, onEvent, onEnd) => {
      push = onEvent;
      end = onEnd;
      return stop;
    });
  });

  it("waits for Listen on a finished run, then lists events and stops on request", () => {
    renderWithQuery(<RunEvents runId="r1" status="complete" />);
    expect(ops.streamRunEvents).not.toHaveBeenCalled();
    expect(screen.getByText(/Not listening/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Listen for events" }));
    act(() => push({ type: "progress", data: { stage: "checks", pct: 40 } }));
    act(() => push({ type: "complete", data: {} }));
    const list = screen.getByTestId("run-events-list");
    expect(list).toHaveTextContent("progress");
    expect(list).toHaveTextContent("stage checks, pct 40");
    expect(list).toHaveTextContent("Run finished");
    fireEvent.click(screen.getByRole("button", { name: "Stop listening" }));
    expect(stop).toHaveBeenCalled();
  });

  it("starts by itself on a running run and shows an error with retry", () => {
    renderWithQuery(<RunEvents runId="r1" status="running" />);
    expect(ops.streamRunEvents).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Stop listening" })).toBeInTheDocument();
    act(() => end(new Error("x")));
    expect(screen.getByText("The event stream could not be read.")).toBeInTheDocument();
  });
});

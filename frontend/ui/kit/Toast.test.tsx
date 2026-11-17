import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastHost, useToast } from "./Toast";

function Fire() {
  const toast = useToast();
  return <button type="button" onClick={() => toast("Saved", "good")}>fire</button>;
}

describe("Toast", () => {
  afterEach(() => vi.useRealTimers());
  it("shows a message in a live region and clears it", () => {
    vi.useFakeTimers();
    render(<ToastHost ms={1000}><Fire /></ToastHost>);
    fireEvent.click(screen.getByText("fire"));
    expect(screen.getByRole("status").textContent).toBe("Saved");
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByRole("status").textContent).toBe("");
  });
});

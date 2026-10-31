import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TOAST_MS, ToastProvider, useToast } from "../Toast";
import { CanvasSkeleton, InspectorSkeleton } from "../parts";
import { LIGHT, TOKENS_CSS } from "./tokens-css";

function Poster({ error }: { error?: boolean }) {
  const toast = useToast();
  return (
    <>
      <button type="button" onClick={() => toast.show("Saved", error ? "error" : "info")}>Post</button>
      <button type="button" onClick={() => toast.done({ label: "Accepted 3 values", ids: [] })}>Do</button>
    </>
  );
}
const mount = (error?: boolean) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <div className="m2-root">
        <ToastProvider>
          <Poster error={error} />
        </ToastProvider>
      </div>
    </QueryClientProvider>,
  );

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("notices", () => {
  it("wait while the pointer is on them and leave six seconds after it goes", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Post" }));
    const toast = screen.getByRole("status");
    expect(toast).toHaveTextContent("Saved");
    fireEvent.mouseEnter(toast);
    act(() => vi.advanceTimersByTime(TOAST_MS * 2));
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
    fireEvent.mouseLeave(toast);
    act(() => vi.advanceTimersByTime(TOAST_MS - 100));
    expect(screen.queryByRole("status")).not.toBeNull();
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("mark a change that was made with a check, and an error as an alert", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Do" }));
    const done = screen.getByRole("status");
    expect(done).toHaveAttribute("data-done", "true");
    expect(done.querySelector(".m2-toast-ic svg")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
  });

  it("an error is an alert with its mark drawn by CSS, not a coloured border", () => {
    mount(true);
    fireEvent.click(screen.getByRole("button", { name: "Post" }));
    expect(screen.getByRole("alert")).toHaveAttribute("data-tone", "error");
  });
});

describe("placeholders", () => {
  it("hold the canvas and the inspector in their final geometry and say once that they are loading", () => {
    vi.useRealTimers();
    const { unmount } = render(<CanvasSkeleton />);
    expect(screen.getByTestId("canvas-loading")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    unmount();
    const { container } = render(<InspectorSkeleton />);
    expect(container.querySelectorAll(".m2-fact")).toHaveLength(5);
    expect(container.querySelector(".m2-ih")).not.toBeNull();
    expect(container.querySelector(".m2-acts")).not.toBeNull();
  });
});

describe("motion tokens", () => {
  const motion = TOKENS_CSS.slice(TOKENS_CSS.indexOf("Motion. State changes"));
  it("time state changes at 150ms, arrivals at 200ms and placeholders at a slow breath, all from tokens", () => {
    expect(LIGHT["--m2-t-fast"]).toBe("150ms");
    expect(LIGHT["--m2-t-med"]).toBe("200ms");
    expect(LIGHT["--m2-t-pulse"]).toBe("1600ms");
    for (const m of motion.matchAll(/(?:transition|animation):([^;]+);/g)) expect(m[1].replace(/\b0s\b/g, ""), m[1]).not.toMatch(/\d+m?s\b/);
  });

  it("moves arriving panels without fading their text, so contrast holds from the first frame", () => {
    const arrive = /@keyframes m2-arrive-x \{([\s\S]*?)\n\}/.exec(TOKENS_CSS)?.[1] ?? "";
    expect(arrive).toContain("transform");
    expect(arrive).not.toContain("opacity");
    expect(TOKENS_CSS).toMatch(/\.m2-insp-d \{ animation: m2-arrive-x var\(--m2-t-med\)/);
    expect(TOKENS_CSS).toMatch(/\.m2-skel \{ animation: m2-breathe var\(--m2-t-pulse\)/);
  });

  it("stops every transition and animation under prefers-reduced-motion", () => {
    const reduced = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(TOKENS_CSS)?.[1] ?? "";
    expect(reduced).toContain("transition: none !important");
    expect(reduced).toContain("animation: none !important");
  });
});

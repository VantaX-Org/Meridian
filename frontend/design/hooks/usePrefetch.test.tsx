import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const prefetch = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ prefetch }) }));

import { usePrefetch } from "./usePrefetch";

function Probe() {
  const h = usePrefetch("/objects/x");
  return <button {...h}>go</button>;
}

describe("usePrefetch", () => {
  it("prefetches the route once, 80ms after pointer enter", () => {
    vi.useFakeTimers();
    const { getByText } = render(<Probe />);
    const el = getByText("go");
    act(() => { el.dispatchEvent(new PointerEvent("pointerover", { bubbles: true })); });
    act(() => { el.focus(); });
    expect(prefetch).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(80); });
    expect(prefetch).toHaveBeenCalledTimes(1);
    expect(prefetch).toHaveBeenCalledWith("/objects/x");
    vi.useRealTimers();
  });
});

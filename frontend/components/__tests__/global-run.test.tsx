// One run for every screen: a ?run= is kept, carried onto the next screen, and cleared by going back to latest.
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RUN_KEY, RunCarrier, readSelectedRun } from "../global-run";

const replace = vi.fn();
let pathname = "/objects";
let search = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => pathname,
  useSearchParams: () => search,
}));

const at = (path: string, query = "") => { pathname = path; search = new URLSearchParams(query); };

describe("RunCarrier", () => {
  beforeEach(() => { replace.mockClear(); window.localStorage.clear(); at("/objects"); });

  it("keeps the run on the URL as the chosen run", () => {
    at("/objects", "run=r1");
    render(<RunCarrier />);
    expect(readSelectedRun()).toBe("r1");
    expect(replace).not.toHaveBeenCalled();
  });

  it("carries the chosen run onto a screen opened without one", () => {
    window.localStorage.setItem(RUN_KEY, "r1");
    at("/fix", "tab=batches");
    render(<RunCarrier />);
    expect(replace).toHaveBeenCalledWith("/fix?tab=batches&run=r1", { scroll: false });
  });

  it("goes back to the latest when the run is removed on the same screen", () => {
    at("/objects", "run=r1");
    const { rerender } = render(<RunCarrier />);
    at("/objects");
    rerender(<RunCarrier />);
    expect(readSelectedRun()).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it("leaves screens whose ?run= is their own alone", () => {
    window.localStorage.setItem(RUN_KEY, "r1");
    at("/process/ptp", "run=discovery-7");
    render(<RunCarrier />);
    expect(readSelectedRun()).toBe("r1");
    expect(replace).not.toHaveBeenCalled();
  });
});

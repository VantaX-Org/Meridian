// One run for every screen: a ?run= is kept, carried onto the next screen, and cleared by going back to latest.
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalObjectPicker, GlobalRunPicker, OBJECT_KEY, RUN_KEY, RunCarrier, readSelectedObject, readSelectedRun } from "../global-run";

const replace = vi.fn();
let pathname = "/objects";
let search = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => pathname,
  useSearchParams: () => search,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: { objects: [{ module: "material_master", label: "Material master" }] } }),
}));

vi.mock("@/hooks/use-run-list", () => ({
  useRunList: () => ({ data: { versions: [{ id: "r1", label: "Run 1", status: "complete", run_at: "2026-10-16T00:00:00Z", dqs_summary: {}, metadata: {} }] } }),
}));

const at = (path: string, query = "") => { pathname = path; search = new URLSearchParams(query); };

describe("RunCarrier", () => {
  beforeEach(() => { replace.mockClear(); window.sessionStorage.clear(); window.localStorage.clear(); at("/objects"); });

  it("keeps the choice for this tab's session only, never across sessions", () => {
    at("/objects", "run=r1");
    render(<RunCarrier />);
    expect(window.sessionStorage.getItem(RUN_KEY)).toBe("r1");
    expect(window.localStorage.getItem(RUN_KEY)).toBeNull();
  });

  it.each(["/home", "/home/lead", "/insights", "/insights/exec", "/insights/progress", "/insights/impact", "/insights/process"])("never carries a run or an object onto the current-state view %s", (path) => {
    window.sessionStorage.setItem(RUN_KEY, "r1");
    window.sessionStorage.setItem(OBJECT_KEY, "material_master");
    at(path);
    render(<RunCarrier />);
    expect(replace).not.toHaveBeenCalled();
  });

  it("does not make a current-state view's own ?run= pin the other screens", () => {
    at("/home/lead", "run=r9");
    render(<RunCarrier />);
    expect(readSelectedRun()).toBeNull();
  });

  it("still carries the chosen run onto a one-run insight view", () => {
    window.sessionStorage.setItem(RUN_KEY, "r1");
    at("/insights/rules");
    render(<RunCarrier />);
    expect(replace).toHaveBeenCalledWith("/insights/rules?run=r1", { scroll: false });
  });

  it("keeps the run on the URL as the chosen run", () => {
    at("/objects", "run=r1");
    render(<RunCarrier />);
    expect(readSelectedRun()).toBe("r1");
    expect(replace).not.toHaveBeenCalled();
  });

  it("carries the chosen run onto a screen opened without one", () => {
    window.sessionStorage.setItem(RUN_KEY, "r1");
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
    window.sessionStorage.setItem(RUN_KEY, "r1");
    at("/process/ptp", "run=discovery-7");
    render(<RunCarrier />);
    expect(readSelectedRun()).toBe("r1");
    expect(replace).not.toHaveBeenCalled();
  });

  it("carries the chosen object along with the run", () => {
    window.sessionStorage.setItem(RUN_KEY, "r1");
    window.sessionStorage.setItem(OBJECT_KEY, "material_master");
    at("/insights/rules");
    render(<RunCarrier />);
    expect(replace).toHaveBeenCalledWith("/insights/rules?run=r1&module=material_master", { scroll: false });
  });

  it("makes an object page's object the choice, without adding it to the URL", () => {
    at("/objects/accounts_payable", "run=r1");
    render(<RunCarrier />);
    expect(readSelectedObject()).toBe("accounts_payable");
    expect(replace).not.toHaveBeenCalled();
  });

  it.each(["/admin/users", "/mdm", "/inbox", "/systems", "/runs", "/fix/proposals/r1"])("never carries a run or an object onto %s, which reads neither", (path) => {
    window.sessionStorage.setItem(RUN_KEY, "r1");
    window.sessionStorage.setItem(OBJECT_KEY, "material_master");
    at(path);
    render(<RunCarrier />);
    expect(replace).not.toHaveBeenCalled();
  });

  it("carries only the run onto a screen that reads the run but not the object", () => {
    window.sessionStorage.setItem(RUN_KEY, "r1");
    window.sessionStorage.setItem(OBJECT_KEY, "material_master");
    at("/search", "q=abc");
    render(<RunCarrier />);
    expect(replace).toHaveBeenCalledWith("/search?q=abc&run=r1", { scroll: false });
  });

  it("carries only the object onto a screen that reads the object but not the run", () => {
    window.sessionStorage.setItem(RUN_KEY, "r1");
    window.sessionStorage.setItem(OBJECT_KEY, "material_master");
    at("/rules");
    render(<RunCarrier />);
    expect(replace).toHaveBeenCalledWith("/rules?module=material_master", { scroll: false });
  });

  it("does not let a stray ?run= on a screen that ignores it become the choice", () => {
    at("/admin/users", "run=r9");
    render(<RunCarrier />);
    expect(readSelectedRun()).toBeNull();
  });

  it("clears the object when Every object is chosen on the same screen", () => {
    at("/fix", "module=material_master");
    const { rerender } = render(<RunCarrier />);
    at("/fix");
    rerender(<RunCarrier />);
    expect(readSelectedObject()).toBeNull();
  });
});

describe("GlobalRunPicker", () => {
  it("is hidden on the current-state views, whose header picker names the scope \"Current state\"", () => {
    for (const path of ["/home/lead", "/insights", "/insights/exec", "/insights/progress", "/insights/impact", "/insights/process"]) {
      at(path);
      const { queryByTestId, unmount } = render(<GlobalRunPicker />);
      expect(queryByTestId("global-run")).toBeNull();
      unmount();
    }
  });

  it("shows on a one-run screen", () => {
    at("/objects");
    const { getByTestId } = render(<GlobalRunPicker />);
    expect(getByTestId("global-run")).toBeInTheDocument();
  });

  it.each(["/fix", "/objects", "/objects/material_master"])("names the default of %s \"Current state\", the scope it opens on", (path) => {
    at(path);
    const { getByTestId } = render(<GlobalRunPicker />);
    expect(getByTestId("global-run")).toHaveTextContent("Current state");
    expect(getByTestId("global-run")).not.toHaveTextContent("Latest run");
  });

  it("names the default \"Latest run\" where a screen still opens on the newest run", () => {
    at("/insights/rules");
    const { getByTestId } = render(<GlobalRunPicker />);
    expect(getByTestId("global-run")).toHaveTextContent("Latest run");
  });
});

describe("scope bar pickers outside the screens that read them", () => {
  it.each(["/admin/users", "/mdm", "/inbox", "/systems", "/runs", "/home/lead"])("hides the run picker on %s", (path) => {
    at(path);
    const { queryByTestId } = render(<GlobalRunPicker />);
    expect(queryByTestId("global-run")).toBeNull();
  });

  it.each(["/admin/users", "/mdm", "/inbox", "/objects", "/search", "/home/lead", "/runs/r1"])("hides the object picker on %s", (path) => {
    at(path);
    const { queryByTestId } = render(<GlobalObjectPicker />);
    expect(queryByTestId("global-object")).toBeNull();
  });

  it.each(["/fix", "/insights/rules", "/rules", "/objects/material_master"])("shows the object picker on %s", (path) => {
    at(path);
    const { getByTestId } = render(<GlobalObjectPicker />);
    expect(getByTestId("global-object")).toBeInTheDocument();
  });

  it.each(["/fix", "/insights/rules", "/search", "/objects/material_master"])("shows the run picker on %s", (path) => {
    at(path);
    const { getByTestId } = render(<GlobalRunPicker />);
    expect(getByTestId("global-run")).toBeInTheDocument();
  });
});

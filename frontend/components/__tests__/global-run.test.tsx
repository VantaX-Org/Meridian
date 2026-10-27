// A chosen run is kept for this tab, carried only onto one-run screens, and cleared by going back to latest;
// cross-object screens open on the current state unless the link names a run or an object.
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalObjectPicker, GlobalRunPicker, OBJECT_KEY, RUN_KEY, RunCarrier, pickerObjects, readSelectedObject, readSelectedRun } from "../global-run";
import type { Version } from "@/types/api";

const replace = vi.fn();
let pathname = "/objects";
let search = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => pathname,
  useSearchParams: () => search,
}));

const summary = (score: number) => ({ composite_score: score, critical_count: 0, high_count: 0, medium_count: 0, low_count: 0 });
// The newest run measured controlling only; material master is current from an older run of its own lineage.
const VERSIONS = [
  { id: "r1", label: "Run 1", status: "complete", run_at: "2026-10-16T00:00:00Z", dqs_summary: { controlling: summary(70) }, metadata: {} },
  { id: "r0", label: "Run 0", status: "complete", run_at: "2026-10-15T00:00:00Z", dqs_summary: { material_master: summary(80) }, metadata: {} },
];
vi.mock("@/hooks/use-run-list", () => ({
  useRunList: () => ({ data: { versions: VERSIONS } }),
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

  it.each(["/fix", "/fix?tab=cleaning", "/fix?mine=1", "/insights/rules", "/insights/duplicates", "/insights/readiness", "/insights/trends", "/objects", "/objects/controlling", "/rules"])(
    "never carries a run or an object from the page before onto the cross-object screen %s",
    (href) => {
      // The steward opened material master's 25k run, then followed a plain link here.
      window.sessionStorage.setItem(RUN_KEY, "r1");
      window.sessionStorage.setItem(OBJECT_KEY, "material_master");
      const [path, query = ""] = href.split("?");
      at(path, query);
      render(<RunCarrier />);
      expect(replace).not.toHaveBeenCalled();
    },
  );

  it("keeps a run the link names on a cross-object screen", () => {
    at("/fix", "run=r1&module=material_master");
    render(<RunCarrier />);
    expect(replace).not.toHaveBeenCalled();
    expect(readSelectedRun()).toBe("r1");
  });

  it("keeps the run on the URL as the chosen run", () => {
    at("/objects", "run=r1");
    render(<RunCarrier />);
    expect(readSelectedRun()).toBe("r1");
    expect(replace).not.toHaveBeenCalled();
  });

  it("carries the chosen run onto a one-run screen opened without one", () => {
    window.sessionStorage.setItem(RUN_KEY, "r1");
    at("/rules/learned");
    render(<RunCarrier />);
    expect(replace).toHaveBeenCalledWith("/rules/learned?run=r1", { scroll: false });
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

describe("GlobalObjectPicker", () => {
  it("names the object applied on the URL, never \"Every object\"", () => {
    at("/fix", "module=material_master");
    const { getByTestId } = render(<GlobalObjectPicker />);
    expect(getByTestId("global-object")).toHaveTextContent("Material master");
    expect(getByTestId("global-object")).not.toHaveTextContent("Every object");
  });

  it("offers every object of the current state, not only the newest run's", () => {
    expect(pickerObjects(VERSIONS as unknown as Version[], null).map((o) => o.module)).toEqual(["controlling", "material_master"]);
  });

  it("adds an applied object no current run measured, so it is still named", () => {
    expect(pickerObjects(VERSIONS as unknown as Version[], "hcm").map((o) => o.module)).toContain("hcm");
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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { ToastProvider } from "@/design/next/kit";
import { Load } from "@/design/next/screens/Load";
import { getUrl, push, setUrl } from "@/design/v2/__tests__/nav-store";
import { effectOf, verdictOf } from "../Validate";
import { isLoadTab } from "../tabs";

const exportLoadFiles = vi.fn(async () => undefined);
vi.mock("@/lib/api/v2/migration", async (orig) => ({ ...(await orig<typeof import("@/lib/api/v2/migration")>()), exportLoadFiles: (...a: unknown[]) => (exportLoadFiles as (...b: unknown[]) => unknown)(...a) }));
vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.clearAllMocks();
});

function open(tab: Parameters<typeof Load>[0]["tab"], query = "") {
  setUrl(`/load${tab === "prepare" ? "" : `/${tab}`}?fixture=1${query}`);
  return renderWithQuery(<ToastProvider><Load tab={tab} /></ToastProvider>);
}

describe("load tabs", () => {
  it("knows its tab ids", () => {
    expect(isLoadTab("compare")).toBe(true);
    expect(isLoadTab("nope")).toBe(false);
  });

  it("opens a tab as a path segment", async () => {
    open("prepare");
    await screen.findByTestId("load-page");
    fireEvent.click(screen.getByRole("tab", { name: "History" }));
    expect(push).toHaveBeenCalled();
    expect(getUrl()).toMatch(/^\/load\/history/);
  });
});

describe("step 1, choose the target", () => {
  it("offers four targets and marks the ECC formats review only", async () => {
    open("prepare");
    await screen.findByTestId("choose-target");
    for (const id of ["s4", "sf", "ecc", "workbook"]) expect(screen.getByTestId(`target-${id}`)).toBeTruthy();
    expect(screen.getByText("LSMW, BAPI, IDoc: review only")).toBeTruthy();
  });

  it("keeps the next step off until an object is chosen", async () => {
    open("prepare", "&objs=");
    await screen.findByTestId("choose-target");
    expect(within(screen.getByTestId("choose-target")).getByRole("button", { name: /Check what fits/ }).getAttribute("aria-disabled")).toBe("true");
  });
});

describe("step 2, validate", () => {
  it("rates objects from their rejects and warnings", () => {
    expect(verdictOf({ would_fail: 3, provisional: 0 })).toBe("not_ready");
    expect(verdictOf({ would_fail: 0, provisional: 2 })).toBe("conditions");
    expect(verdictOf({ would_fail: 0, provisional: 0 })).toBe("ready");
    expect(effectOf({ provisional: true, structural: false, records: 5 })).toBe("warns");
    expect(effectOf({ provisional: false, structural: true, records: 0 })).toBe("dropped");
    expect(effectOf({ provisional: false, structural: false, records: 9 })).toBe("rejects");
  });

  it("shows a verdict per object and asks before building without rejected rows", async () => {
    open("prepare", "&step=validate&target=s4&run=mig-0002&objs=material_master,business_partner");
    const v = await screen.findByTestId("validate");
    const row = await screen.findByTestId("verdict-material_master");
    expect(within(row).getByText("Not ready to load")).toBeTruthy();
    expect(row.textContent).toMatch(/27,184 would load/);
    fireEvent.click(within(v).getByRole("button", { name: "Build the load files" }));
    expect(await screen.findByText(/rows would be rejected\. Build the files without them\?/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Build without them" })).toBeTruthy();
  });
});

describe("step 3, files", () => {
  it("says so when the load order is not known for an object", async () => {
    open("prepare", "&step=files&target=s4&run=mig-0002&objs=business_partner,material_master");
    await screen.findByTestId("files");
    await screen.findByTestId("file-material_master");
    const text = screen.getByTestId("files").textContent ?? "";
    expect(text).toMatch(/Order not known for|Depends on/);
  });

  it("downloads the run's files in the chosen format", async () => {
    open("prepare", "&step=files&target=s4&run=mig-0002&objs=material_master");
    await screen.findByTestId("file-material_master");
    fireEvent.click(screen.getByRole("button", { name: "Download all" }));
    await waitFor(() => expect(exportLoadFiles).toHaveBeenCalledWith("mig-0002", "xlsx"));
  });
});

describe("history tab", () => {
  it("lists the files handed over", async () => {
    open("history");
    expect(await screen.findByTestId("load-history")).toBeTruthy();
    await waitFor(() => expect(screen.getAllByRole("row").length).toBeGreaterThan(1));
  });
});

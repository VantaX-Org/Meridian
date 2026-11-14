import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { ToastProvider } from "@/design/next/kit";
import { SheetHost } from "@/design/next/shell/SheetHost";
import { registerSheet, registry } from "@/design/next/shell/registry";
import { ObjectPage } from "@/design/next/screens/ObjectPage";
import { Count, Denied, Trunc, compactCount, isDenied } from "../edge";
import { setUrl, getUrl } from "@/design/v2/__tests__/nav-store";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

// The compare sheet lands with the Work batch; until then the host would drop the unknown name, so stand one in.
if (!registry.has("compare")) registerSheet("compare", () => <div data-testid="compare-sheet" />);

const SYS = "ecc-production";
const MOD = "material-master";

beforeEach(() => window.sessionStorage.setItem("mn_v2_fixture", "1"));
afterEach(() => {
  window.sessionStorage.clear();
  vi.clearAllMocks();
});

function page(query: string, tab: "overview" | "runs" = "overview") {
  setUrl(`/next/o/${SYS}/${MOD}/${tab}?fixture=1${query}`);
  return renderWithQuery(
    <ToastProvider><SheetHost><ObjectPage system={SYS} module={MOD} tab={tab} /></SheetHost></ToastProvider>,
  );
}

describe("edge parts", () => {
  it("keeps small counts whole, shortens big ones and keeps zero", () => {
    expect(compactCount(0)).toBe("0");
    expect(compactCount(9_999)).toMatch(/9.999/);
    expect(compactCount(1_234_567)).toMatch(/^1[.,]2\s?M$/);
  });

  it("shows the exact count as the tooltip of the short form", () => {
    render(<Count n={1_234_567} />);
    expect(screen.getByTitle(/1.234.567/)).toBeTruthy();
  });

  it("cuts a long name and keeps the full text as the tooltip", () => {
    const long = "Material description is longer than the column can ever show in one line";
    render(<Trunc text={long} />);
    const el = screen.getByTitle(long);
    expect(el.className).toContain("nx-trunc");
  });

  it("knows a 403 from other errors", () => {
    expect(isDenied({ response: { status: 403 } })).toBe(true);
    expect(isDenied({ response: { status: 500 } })).toBe(false);
    expect(isDenied(null)).toBe(false);
  });

  it("draws the no-access screen with what was denied", () => {
    render(<Denied what="this object" />);
    expect(screen.getByTestId("access-denied").textContent).toContain("You do not have access to this object");
  });
});

describe("object page states and sheets", () => {
  it("shows skeletons first and the hero after", async () => {
    page("");
    expect(screen.queryByTestId("object-bar")).toBeNull();
    expect(await screen.findByTestId("object-bar")).toBeTruthy();
  });

  it("shows the paired scores in the hero", async () => {
    page("");
    expect(await screen.findByTestId("paired-scores")).toBeTruthy();
  });

  it("shows the why and fix sections and the trend with its figures", async () => {
    page("");
    expect(await screen.findByTestId("why-section")).toBeTruthy();
    expect(await screen.findByTestId("fix-section")).toBeTruthy();
    const trend = await screen.findByTestId("trend-stack");
    expect(trend.textContent).toContain("Show the figures");
  });

  it("restores the score sheet from the address after a refresh", async () => {
    page(`&sheet=score:${MOD}`);
    expect(await screen.findByTestId("score-sheet")).toBeTruthy();
  });

  it("wires the Evidence sheet: it opens from the address and renders", async () => {
    page(`&sheet=evidence:${MOD}`);
    expect(await screen.findByTestId("evidence-sheet")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("Loading the evidence")).toBeNull());
  });

  it("opens a run as a sheet with a link to its page", async () => {
    page("&sheet=object-run:r1");
    expect(await screen.findByTestId("run-sheet")).toBeTruthy();
    const link = await screen.findByRole("link", { name: "Open as page" });
    expect(link.getAttribute("href")).toMatch(/\/run\/r1/);
  });

  it("sends an old cycle compare link to the compare sheet", async () => {
    setUrl(`/next/o/${SYS}/${MOD}/cycle?fixture=1&step=compare`);
    renderWithQuery(<ToastProvider><SheetHost><ObjectPage system={SYS} module={MOD} tab={"cycle" as never} /></SheetHost></ToastProvider>);
    await waitFor(() => expect(getUrl()).toMatch(/\/overview\?.*sheet=compare/));
    expect(getUrl()).not.toMatch(/step=/);
  });
});

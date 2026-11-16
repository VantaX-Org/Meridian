import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { ToastProvider } from "../../kit";
import { Landscape } from "../Landscape";
import { Atlas } from "../Atlas";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

const Q = vi.hoisted(() => ({ can: (() => true) as (a: string) => boolean, shared: false, persona: "admin" }));
vi.mock("@/lib/v2/hooks", async (orig) => ({
  ...(await orig<object>()),
  useV2Session: () => ({ can: Q.can, id: "me", name: "Me", email: "me@example.com", persona: Q.persona, label: "Admin", fixture: true, viewAs: null, shared: Q.shared }),
}));

const wrap = (ui: React.ReactElement) => renderWithQuery(<ToastProvider>{ui}</ToastProvider>);
const go = (search: string) => window.history.pushState({}, "", `/more?fixture=1${search}`);

beforeEach(() => {
  go("");
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  Q.can = () => true;
  Q.shared = false;
  Q.persona = "admin";
});

describe("Landscape (native)", () => {
  it("renders the fixture landscape with the sentence, status and coverage matrix", async () => {
    wrap(<Landscape />);
    expect(await screen.findByTestId("landscape-sentence")).toBeInTheDocument();
    expect(screen.getByTestId("coverage-matrix")).toBeInTheDocument();
    expect(screen.getByTestId("landscape-status")).toBeInTheDocument();
    expect(screen.getAllByTestId("matrix-cell").length).toBeGreaterThan(0);
  });

  it("switches the coverage view to waves", async () => {
    wrap(<Landscape />);
    const toggle = await screen.findByTestId("view-toggle");
    fireEvent.click(within(toggle).getByRole("radio", { name: "Waves" }));
    await waitFor(() => expect(screen.getAllByTestId("wave-head").length).toBeGreaterThan(0));
    expect(await screen.findByTestId("waves-by-value")).toBeInTheDocument();
  });

  it("tells a user without the manage systems permission that connecting needs it", async () => {
    go("&landscape=empty");
    Q.can = () => false;
    wrap(<Landscape />);
    expect(await screen.findByTestId("connect-denied")).toHaveTextContent("manage systems permission");
    expect(screen.getByTestId("request-access")).toHaveTextContent("Request access");
  });

  it("exports the coverage matrix as CSV for a user holding the export permission", async () => {
    const created = vi.fn(() => "blob:x");
    Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() });
    wrap(<Landscape />);
    const matrix = await screen.findByTestId("coverage-matrix");
    const box = matrix.closest("[data-testid='table-export']") as HTMLElement;
    expect(box).not.toBeNull();
    fireEvent.click(within(box).getByTestId("export-csv"));
    await waitFor(() => expect(within(box).getByRole("status")).toHaveTextContent(/Exported \d+ rows to/));
    expect(created).toHaveBeenCalled();
  });

  it("hides the export without the export permission", async () => {
    Q.can = (a) => a !== "export";
    wrap(<Landscape />);
    await screen.findByTestId("coverage-matrix");
    expect(screen.queryByTestId("table-export")).toBeNull();
  });
});

describe("Atlas (native)", () => {
  it("replays the runs: the last bar starts pressed, picking a bar moves there", async () => {
    wrap(<Atlas />);
    const strip = await screen.findByTestId("atlas-strip");
    const bars = within(strip).getAllByRole("button");
    expect(bars.length).toBeGreaterThan(1);
    expect(bars[bars.length - 1]).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(bars[0]);
    expect(bars[0]).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("atlas-play")).toHaveTextContent("Play from here");
    fireEvent.click(screen.getByTestId("atlas-play"));
    expect(screen.getByTestId("atlas-pause")).toBeInTheDocument();
    const tiles = within(screen.getByTestId("atlas-mosaic")).getAllByTestId("atlas-tile");
    expect(tiles[0].getAttribute("href")).toMatch(/^\/o\/[^/]+\/[^/?]+\?run=/);
  });
});

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TourDef } from "@/lib/help/tours";
import { isTourDone } from "@/lib/help/storage";
import { readPrefs, resetPreferencesCache, setPreferences } from "@/lib/preferences";
import { TourHost, TourOffer, startTour, stopTour } from "./Tour";

const TOURS: TourDef[] = [
  {
    id: "t",
    title: "Test tour",
    steps: [
      { target: "alpha", title: "First", body: "About alpha", placement: "bottom" },
      { target: "beta", title: "Second", body: "About beta", placement: "right" },
      { target: "gamma", title: "Third", body: "About gamma" },
    ],
  },
  { id: "once", title: "One shot", oneShot: true, steps: [{ target: "alpha", title: "Only", body: "Only step" }] },
  {
    id: "opt",
    title: "Optional",
    steps: [
      { target: "alpha", title: "Here", body: "Present" },
      { target: "absent", title: "Not here", body: "Never rendered", optional: true },
      { target: "beta", title: "After", body: "Present too" },
    ],
  },
  { id: "gone", title: "Missing", steps: [{ target: "absent", title: "Lost", body: "No such element" }] },
  {
    id: "far",
    title: "Other page",
    steps: [
      { target: "alpha", title: "Elsewhere", body: "On another page", href: "/other?x=1" },
      { target: "beta", title: "Skipped", body: "Cannot resolve", href: "/needs/{system}" },
    ],
  },
];

function Page() {
  return (
    <div>
      <button data-tour="alpha">Alpha</button>
      <button data-tour="beta">Beta</button>
      <button data-tour="gamma">Gamma</button>
    </div>
  );
}

const rect = { top: 100, left: 100, width: 200, height: 40, right: 300, bottom: 140, x: 100, y: 100, toJSON: () => ({}) };

beforeEach(() => {
  localStorage.clear();
  resetPreferencesCache();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect as DOMRect);
});

afterEach(() => {
  act(() => stopTour());
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function open(id: string, host: Partial<Parameters<typeof TourHost>[0]> = {}) {
  render(<><Page /><TourHost tours={TOURS} {...host} /></>);
  await act(async () => { startTour(id); });
}

describe("Tour", () => {
  it("renders nothing until a tour starts", () => {
    render(<><Page /><TourHost tours={TOURS} /></>);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows step N of M for the first step, with Back disabled", async () => {
    await open("t");
    const dialog = await screen.findByRole("dialog", { name: "First" });
    expect(dialog).toHaveTextContent("About alpha");
    expect(dialog).toHaveTextContent("Step 1 of 3");
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    expect(screen.getByTestId("tour")).toHaveAttribute("data-tour-target", "alpha");
  });

  it("cuts a spotlight around the target with no blur", async () => {
    await open("t");
    await screen.findByRole("dialog");
    const spot = screen.getByTestId("tour-spot");
    expect(spot.style.top).toBe("94px");
    expect(spot.style.left).toBe("94px");
    expect(spot.style.width).toBe("212px");
    expect(spot.style.height).toBe("52px");
    expect(screen.getByTestId("tour").innerHTML).not.toMatch(/blur/);
  });

  it("walks forward and back, then Done marks it complete", async () => {
    await open("t");
    await screen.findByRole("dialog", { name: "First" });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("dialog", { name: "Second" })).toHaveTextContent("Step 2 of 3");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("dialog", { name: "First" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByRole("dialog", { name: "Second" });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByRole("dialog", { name: "Third" });
    expect(isTourDone("t")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(readPrefs().tours_done).toEqual(["t"]);
  });

  it("Escape closes without marking a normal tour done", async () => {
    await open("t");
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(isTourDone("t")).toBe(false);
  });

  it("Skip tour closes it without marking it done, and the last step offers Done instead", async () => {
    await open("t");
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Skip tour" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(isTourDone("t")).toBe(false);
    await act(async () => { startTour("once"); });
    await screen.findByRole("dialog", { name: "Only" });
    expect(screen.queryByRole("button", { name: "Skip tour" })).toBeNull();
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
  });

  it("Escape on a one-shot offer counts as seen", async () => {
    await open("once");
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(isTourDone("once")).toBe(true);
  });

  it("moves focus into the card and keeps Tab inside it", async () => {
    await open("t");
    const dialog = await screen.findByRole("dialog");
    const next = screen.getByRole("button", { name: "Next" });
    expect(next).toHaveFocus();
    // Next is the last enabled button (Back is disabled on step 1): Tab wraps to the first focusable, Skip tour.
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(screen.getByRole("button", { name: "Skip tour" })).toHaveFocus();
    fireEvent.click(next);
    await screen.findByRole("dialog", { name: "Second" });
    const skip = screen.getByRole("button", { name: "Skip tour" });
    const done = screen.getByRole("button", { name: "Next" });
    done.focus();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab" });
    expect(skip).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab", shiftKey: true });
    expect(done).toHaveFocus();
  });

  it("skips an optional step whose target is absent", async () => {
    vi.useFakeTimers();
    render(<><Page /><TourHost tours={TOURS} /></>);
    await act(async () => { startTour("opt"); });
    expect(screen.getByRole("dialog", { name: "Here" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(screen.getByRole("dialog", { name: "After" })).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveTextContent("Step 3 of 3");
  });

  it("flags a missing required target instead of hanging", async () => {
    vi.useFakeTimers();
    render(<><Page /><TourHost tours={TOURS} /></>);
    await act(async () => { startTour("gone"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(screen.getByTestId("tour")).toHaveAttribute("data-tour-missing", "true");
    expect(screen.getByRole("dialog", { name: "Lost" })).toBeInTheDocument();
  });

  it("opens a step's page first, and skips a step whose link cannot be resolved", async () => {
    const navigate = vi.fn();
    const resolveHref = vi.fn(async (href: string) => (href.includes("{system}") ? null : href));
    await open("far", { navigate, resolveHref });
    await screen.findByRole("dialog", { name: "Elsewhere" });
    expect(navigate).toHaveBeenCalledWith("/other?x=1");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    // The second step resolves to null, so the tour ends instead of showing it.
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole("dialog", { name: "Skipped" })).toBeNull();
  });
});

describe("TourOffer", () => {
  it("offers a tour until it is taken or dismissed", async () => {
    render(<><Page /><TourOffer id="t" tours={TOURS} /><TourHost tours={TOURS} /></>);
    expect(await screen.findByText("New here?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Take the tour" }));
    expect(await screen.findByRole("dialog", { name: "First" })).toBeInTheDocument();
    expect(screen.queryByText("New here?")).toBeNull();
  });

  it("stays away once dismissed", async () => {
    render(<TourOffer id="t" tours={TOURS} />);
    fireEvent.click(await screen.findByRole("button", { name: "Not now" }));
    expect(screen.queryByText("New here?")).toBeNull();
    expect(isTourDone("t")).toBe(true);
  });

  it("is not shown for a tour already done", () => {
    setPreferences({ tours_done: ["t"] });
    render(<TourOffer id="t" tours={TOURS} />);
    expect(screen.queryByText("New here?")).toBeNull();
  });
});

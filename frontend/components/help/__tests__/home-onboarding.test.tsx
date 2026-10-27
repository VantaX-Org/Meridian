import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HomeOnboarding } from "../home-onboarding";

const state = vi.hoisted(() => ({ allowed: true, tourDone: false, offerClosed: false, offered: false, dismissed: false, activeTour: null as string | null, items: [] as { id: string; label: string; done: boolean; href: string }[] }));
const actions = vi.hoisted(() => ({ startTour: vi.fn(), closeTourOffer: vi.fn(), dismissChecklist: vi.fn(), markOffered: vi.fn() }));

vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => state.allowed }) }));
vi.mock("@/hooks/use-first-run-checklist", () => ({ useFirstRunChecklist: () => ({ loading: false, items: state.items }) }));
vi.mock("@/lib/help/storage", () => ({
  dismissChecklist: actions.dismissChecklist,
  isChecklistDismissed: () => state.dismissed,
  isTourDone: () => state.tourDone,
  isTourOfferClosed: () => state.offerClosed,
  closeTourOffer: actions.closeTourOffer,
  wasTourOfferedThisSession: () => state.offered,
  markTourOfferedThisSession: (id: string) => { state.offered = true; actions.markOffered(id); },
  subscribeStorage: () => () => {},
}));
vi.mock("@/design", () => ({
  startTour: actions.startTour,
  useActiveTourId: () => state.activeTour,
  Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => <button type="button" onClick={onClick}>{children}</button>,
  Notice: ({ title, children, action }: { title?: React.ReactNode; children?: React.ReactNode; action?: React.ReactNode }) => (
    <div role="status" data-testid="notice">{title ? <p>{title}</p> : null}{children}{action}</div>
  ),
}));

const item = (id: string, label: string, done = false) => ({ id, label, done, href: `/${id}` });

beforeEach(() => {
  Object.assign(state, { allowed: true, tourDone: true, offerClosed: false, offered: false, dismissed: false, activeTour: null, items: [item("fix", "Create a first fix batch")] });
  vi.clearAllMocks();
});

describe("HomeOnboarding", () => {
  it("shows the setup checklist to whoever manages systems", () => {
    render(<HomeOnboarding />);
    expect(screen.getByText("Create a first fix batch")).toBeInTheDocument();
    expect(screen.getByText("0 of 1 done")).toBeInTheDocument();
  });

  it("hides it from everyone else, viewers included", () => {
    state.allowed = false;
    const { container } = render(<HomeOnboarding />);
    expect(screen.queryByText("Create a first fix batch")).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it("names the first two open steps in one row and counts the rest", () => {
    state.items = [item("system", "Connect a system", true), item("a", "Step a"), item("b", "Step b"), item("c", "Step c"), item("d", "Step d")];
    render(<HomeOnboarding />);
    expect(screen.getByRole("link", { name: "Step a" })).toHaveAttribute("href", "/a");
    expect(screen.getByRole("link", { name: "Step b" })).toBeInTheDocument();
    expect(screen.queryByText("Step c")).toBeNull();
    expect(screen.getByText("and 2 more")).toBeInTheDocument();
    expect(screen.queryByText("Connect a system")).toBeNull();
    expect(screen.getByTestId("home-onboarding").children).toHaveLength(1);
  });

  it("dismisses the checklist", () => {
    render(<HomeOnboarding />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(actions.dismissChecklist).toHaveBeenCalled();
  });

  it("offers the first-run tour beside the checklist in the same row", () => {
    state.tourDone = false;
    render(<HomeOnboarding />);
    expect(screen.getAllByTestId("home-onboarding")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Take the tour" }));
    expect(actions.startTour).toHaveBeenCalledWith("first-run");
    // Taking the tour closes the offer as putting it off does.
    expect(actions.closeTourOffer).toHaveBeenCalledWith("first-run");
    actions.closeTourOffer.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(actions.closeTourOffer).toHaveBeenCalledWith("first-run");
  });

  it("offers the tour once per session: the next home leaves it out", () => {
    state.tourDone = false;
    state.items = [];
    const first = render(<HomeOnboarding />);
    expect(screen.getByText(/A short tour shows where things are/)).toBeInTheDocument();
    expect(actions.markOffered).toHaveBeenCalledWith("first-run");
    first.unmount();
    expect(render(<HomeOnboarding />).container).toBeEmptyDOMElement();
  });

  it("stays closed on this device when the account-wide save did not land", () => {
    state.tourDone = false;
    state.offerClosed = true;
    state.items = [];
    expect(render(<HomeOnboarding />).container).toBeEmptyDOMElement();
  });

  it("shows nothing once the tour is done and the checklist dismissed, or every step is done", () => {
    state.dismissed = true;
    expect(render(<HomeOnboarding />).container).toBeEmptyDOMElement();
    state.dismissed = false;
    state.items = [item("fix", "Create a first fix batch", true)];
    expect(render(<HomeOnboarding />).container).toBeEmptyDOMElement();
  });

  it("does not offer the tour while one is running", () => {
    state.tourDone = false;
    state.activeTour = "first-run";
    render(<HomeOnboarding />);
    expect(screen.queryByRole("button", { name: "Take the tour" })).toBeNull();
  });
});

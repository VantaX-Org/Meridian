import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as inboxApi from "@/lib/api/v2/inbox";
import { resetWorkFixture } from "@/lib/api/v2/fixtures";
import { V2Shell } from "../shell/V2Shell";
import { getUrl, push, setUrl } from "./nav-store";
import { stubLayout } from "./layout-stub";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

let undoLayout: () => void = () => undefined;

beforeEach(() => {
  window.sessionStorage.clear();
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;
  resetWorkFixture();
  push.mockClear();
  undoLayout = stubLayout(1400, 700);
  setUrl("/?fixture=1");
});
afterEach(() => {
  undoLayout();
  vi.restoreAllMocks();
});

const text = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
const mount = () => renderWithQuery(<V2Shell><h1>Page</h1></V2Shell>);
const openPanel = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "Inbox 7, unread" }));
  const panel = await screen.findByTestId("inbox-panel");
  await within(panel).findByRole("heading", { name: "Today" });
  return panel;
};
const items = (panel: HTMLElement) => Array.from(panel.querySelectorAll<HTMLElement>("li[data-nid]"));

describe("the inbox panel", () => {
  it("opens from the Inbox count in the top bar as the inspector's frame, and the address carries it", async () => {
    mount();
    const panel = await openPanel();
    expect(getUrl()).toContain("open=inbox");
    const frame = screen.getByTestId("inspector");
    expect(within(frame).getByRole("heading", { level: 2, name: "Inbox" })).toBeInTheDocument();
    expect(frame.contains(panel)).toBe(true);
    expect(text(frame.querySelector(".m2-ih-sl") as Element)).toBe("7 unread");
    expect(screen.getByRole("button", { name: "Inbox 7, unread" })).toHaveAttribute("aria-expanded", "true");
  });

  it("opens straight from ?open=inbox", async () => {
    setUrl("/?fixture=1&open=inbox");
    mount();
    expect(await screen.findByTestId("inbox-panel")).toBeInTheDocument();
  });

  it("groups notifications Today and Earlier, newest first, each with its kind mark and sentence", async () => {
    mount();
    const panel = await openPanel();
    const today = within(within(panel).getByRole("region", { name: "Today" })).getAllByRole("listitem");
    const earlier = within(within(panel).getByRole("region", { name: "Earlier" })).getAllByRole("listitem");
    expect(today).toHaveLength(4);
    expect(earlier).toHaveLength(8);
    expect(text(today[0])).toContain("Approval");
    expect(text(today[0])).toContain("Batch B-241 waits for your approval");
    expect(text(today[0])).toContain("328 records of Material master, ZAR 412,600 at risk.");
    expect(text(today[1])).toContain("SLA at risk");
    expect(text(today[2])).toContain("SLA breached");
    expect(today[0].querySelector("svg.m2-vm")).not.toBeNull();
    // Times for today, dates before.
    expect(text(today[0])).toMatch(/08:41/);
    expect(text(earlier[earlier.length - 1])).toMatch(/\d{1,2} \w{3} \d{4}/);
  });

  it("links an object notification to the object, and a batch one to the batch inspector", async () => {
    mount();
    const panel = await openPanel();
    const rows = items(panel);
    expect(within(rows[1]).getByRole("link", { name: "Material master" }).getAttribute("href")).toContain("/o/ecc-production/material-master");
    expect(within(rows[0]).getByRole("link", { name: "Open the batch" }).getAttribute("href")).toContain("open=batch:B-241");
    // Any other page of the app opens through the router and keeps fixture mode.
    const report = rows.find((r) => text(r).includes("board pack")) as HTMLElement;
    expect(within(report).getByRole("link", { name: "Open" }).getAttribute("href")).toBe("/reports?fixture=1");
  });

  it("marks one read: the API is called, the count in the bar and the list refetch", async () => {
    const mark = vi.spyOn(inboxApi, "putRead");
    mount();
    const panel = await openPanel();
    const first = items(panel)[0];
    fireEvent.click(within(first).getByRole("button", { name: /^Mark read: Batch B-241/ }));
    await waitFor(() => expect(mark).toHaveBeenCalledWith("n1"));
    expect(await screen.findByRole("button", { name: "Inbox 6, unread" })).toBeInTheDocument();
    await waitFor(() => expect(within(items(panel)[0]).queryByRole("button", { name: /^Mark read/ })).toBeNull());
    expect(text(screen.getByTestId("inspector").querySelector(".m2-ih-sl") as Element)).toBe("6 unread");
  });

  it("marks all read", async () => {
    const all = vi.spyOn(inboxApi, "putReadAll");
    mount();
    const panel = await openPanel();
    fireEvent.click(within(panel).getByRole("button", { name: "Mark all read" }));
    await waitFor(() => expect(all).toHaveBeenCalled());
    expect(await screen.findByRole("button", { name: "Inbox 0, unread" })).toBeInTheDocument();
    await waitFor(() => expect(within(panel).getByRole("button", { name: "Mark all read" })).toBeDisabled());
    expect(within(panel).queryByRole("button", { name: /^Mark read/ })).toBeNull();
  });

  it("moves with j and k and opens with Enter, marking the notification read", async () => {
    const mark = vi.spyOn(inboxApi, "putRead");
    mount();
    const panel = await openPanel();
    const rows = () => items(panel);
    await waitFor(() => expect(rows()[0]).toHaveFocus());
    expect(rows()[0]).toHaveAttribute("data-active", "true");
    fireEvent.keyDown(rows()[0], { key: "j" });
    await waitFor(() => expect(rows()[1]).toHaveFocus());
    expect(rows()[1]).toHaveAttribute("data-active", "true");
    expect(rows()[0]).not.toHaveAttribute("data-active");
    fireEvent.keyDown(rows()[1], { key: "k" });
    await waitFor(() => expect(rows()[0]).toHaveFocus());
    fireEvent.keyDown(rows()[0], { key: "Enter" });
    await waitFor(() => expect(mark).toHaveBeenCalledWith("n1"));
    expect(push).toHaveBeenCalledWith(expect.stringContaining("open=batch:B-241"));
  });

  it("k stays on the first and j on the last", async () => {
    mount();
    const panel = await openPanel();
    const rows = () => items(panel);
    await waitFor(() => expect(rows()[0]).toHaveFocus());
    fireEvent.keyDown(rows()[0], { key: "k" });
    expect(rows()[0]).toHaveAttribute("data-active", "true");
    for (let i = 0; i < 20; i++) {
      const at = rows().findIndex((r) => r.getAttribute("data-active") === "true");
      fireEvent.keyDown(rows()[at], { key: "j" });
      await waitFor(() => expect(rows()[Math.min(at + 1, rows().length - 1)]).toHaveAttribute("data-active", "true"));
    }
    expect(rows()[rows().length - 1]).toHaveAttribute("data-active", "true");
  });

  it("links to the existing notification preferences", async () => {
    mount();
    const panel = await openPanel();
    expect(within(panel).getByRole("link", { name: "Notification settings" }).getAttribute("href")).toBe("?open=preferences");
  });

  it("Esc closes it and the address loses it", async () => {
    mount();
    await openPanel();
    fireEvent.keyDown(screen.getByTestId("inspector"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("inbox-panel")).toBeNull());
    expect(getUrl()).not.toContain("open=inbox");
  });

  it("says so when the notifications cannot be read, with Retry", async () => {
    vi.spyOn(inboxApi, "getNotifications").mockRejectedValueOnce(new Error("down"));
    setUrl("/?fixture=1&open=inbox");
    mount();
    expect(await screen.findByText("The notifications could not be read.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { name: "Today" })).toBeInTheDocument();
  });
});

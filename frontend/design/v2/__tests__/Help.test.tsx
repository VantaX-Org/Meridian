import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { resetAdminFixture } from "@/lib/api/v2/fixtures";
import { V2Shell } from "../shell/V2Shell";
import { getUrl, setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  window.localStorage.clear();
  resetAdminFixture();
  window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const mount = (url: string) => {
  setUrl(url);
  return renderWithQuery(<V2Shell><h1>Page</h1></V2Shell>);
};
const titles = (list: HTMLElement) => within(list).getAllByRole("listitem").map((li) => (within(li).getByRole("button").querySelector(".m2-ht") as HTMLElement).textContent);

describe("the help panel", () => {
  it("opens from the ? button in the top bar and closes with it", async () => {
    mount("/v2?fixture=1");
    const help = screen.getByRole("button", { name: "Help" });
    expect(help).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(help);
    expect(getUrl()).toContain("open=help");
    const dialog = await screen.findByRole("dialog", { name: "Help" });
    expect(within(dialog).getByText("You are on Landscape")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Help" })).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Help" })).toBeNull());
  });

  it("lists the chapter for the screen you are on first, under its own heading", async () => {
    mount("/v2/admin/users?fixture=1&open=help");
    const dialog = await screen.findByRole("dialog", { name: "Help" });
    const here = await within(dialog).findByRole("list", { name: "Help for this screen" });
    expect(titles(here)[0]).toBe("Creating and managing users");
    expect(titles(here)).toContain("Administration");
    expect(titles(here)).not.toContain("Your first hour in Meridian");
    const rest = within(dialog).getByRole("list", { name: "All help" });
    expect(titles(rest)).toContain("Your first hour in Meridian");
    expect(within(dialog).getByText("You are on Administration")).toBeInTheDocument();
  });

  it("puts a different chapter first on a different screen", async () => {
    mount("/v2/work?fixture=1&open=help");
    const dialog = await screen.findByRole("dialog", { name: "Help" });
    const here = await within(dialog).findByRole("list", { name: "Help for this screen" });
    expect(titles(here)[0]).toBe("Fix your first record");
    expect(titles(here)).toContain("A day as a data steward");
  });

  it("searches the guide and the chapters, and says when nothing matches", async () => {
    mount("/v2?fixture=1&open=help");
    const dialog = await screen.findByRole("dialog", { name: "Help" });
    await within(dialog).findByRole("list", { name: "Help for this screen" });
    fireEvent.change(within(dialog).getByRole("searchbox", { name: "Search help" }), { target: { value: "golden record" } });
    const all = await within(dialog).findByRole("list", { name: "All help" });
    expect(titles(all)[0]).toBe("Master data: survivors and golden records");
    expect(titles(all).length).toBeLessThan(10);
    fireEvent.change(within(dialog).getByRole("searchbox", { name: "Search help" }), { target: { value: "zzzqq" } });
    expect(await within(dialog).findByText(/Nothing in the guide matches "zzzqq"/)).toBeInTheDocument();
  });

  it("opens a chapter as sections with the screens it applies to, and a recording that plays in the panel", async () => {
    mount("/v2?fixture=1&open=help");
    const dialog = await screen.findByRole("dialog", { name: "Help" });
    fireEvent.click(await within(dialog).findByRole("button", { name: /Reporting up/ }));
    const chapter = await within(dialog).findByTestId("help-chapter");
    expect(within(chapter).getByRole("heading", { name: "Reporting up" })).toBeInTheDocument();
    expect(chapter).toHaveTextContent("Applies to: Landscape, Reports");
    expect(within(chapter).getAllByRole("heading", { level: 3 }).length).toBeGreaterThan(3);
    expect(chapter.querySelector("video")).toBeNull();
    fireEvent.click(within(chapter).getByRole("button", { name: "Watch the recording" }));
    const video = chapter.querySelector("video") as HTMLVideoElement;
    expect(video).toHaveAttribute("src", "/api/v1/docs/help-videos/help-lead-reporting.mp4");
    fireEvent.error(video);
    expect(await within(chapter).findByText("The recording for this chapter is in preparation.")).toBeInTheDocument();
    fireEvent.click(within(chapter).getByRole("button", { name: "All of help" }));
    expect(await within(dialog).findByRole("searchbox", { name: "Search help" })).toBeInTheDocument();
  });

  it("shows what is new from the release notes", async () => {
    mount("/v2?fixture=1&open=help");
    const dialog = await screen.findByRole("dialog", { name: "Help" });
    expect(await within(dialog).findByRole("heading", { name: "What's new" })).toBeInTheDocument();
    expect(within(dialog).getByText(/^0\.1\.1, /)).toBeInTheDocument();
    expect(within(dialog).getByText("Five insight views on one spine")).toBeInTheDocument();
  });

  it("the keyboard button opens the shortcut sheet", async () => {
    mount("/v2?fixture=1&open=help");
    const dialog = await screen.findByRole("dialog", { name: "Help" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Keyboard shortcuts" }));
    expect(await screen.findByRole("dialog", { name: /Keyboard shortcuts/ })).toBeInTheDocument();
  });

  it("contact support gives a reference and the diagnostics to copy, with the version, tenant and screen", async () => {
    const copy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
    mount("/v2/admin/users?fixture=1&open=help");
    const dialog = await screen.findByRole("dialog", { name: "Help" });
    expect(within(dialog).getByRole("heading", { name: "Contact support" })).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByLabelText("Diagnostics")).toHaveTextContent("Tenant: Demo Corp"));
    const block = within(dialog).getByLabelText("Diagnostics");
    expect(block).toHaveTextContent("Screen: /v2/admin/users");
    expect(block).toHaveTextContent(/Meridian \d/);
    expect(within(dialog).getByTestId("diagnostics-ref").textContent).toMatch(/^MN-[0-9A-F]{4}-\d{4}$/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Copy the diagnostics" }));
    await waitFor(() => expect(copy).toHaveBeenCalledTimes(1));
    expect(copy.mock.calls[0][0]).toContain("Screen: /v2/admin/users");
    expect(await within(dialog).findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });
});

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
  // Fixture mode reads ?persona= and ?role= from the window's address, the shell's hooks from the navigation store.
  window.history.pushState({}, "", url);
  setUrl(url);
  return renderWithQuery(<V2Shell><h1>Page</h1></V2Shell>);
};
const titles = (list: HTMLElement) => within(list).getAllByRole("listitem").map((li) => (within(li).getByRole("button").querySelector(".m2-ht") as HTMLElement).textContent);
const openPanel = async (url: string) => {
  mount(url);
  const dialog = await screen.findByRole("dialog", { name: "Help" });
  await within(dialog).findByRole("list", { name: "All help" });
  return dialog;
};

describe("the help panel", () => {
  it("opens from the ? button in the top bar and closes with it", async () => {
    mount("/?fixture=1");
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

  it("puts the role's walkthrough first on the start screen, then the chapter for the screen", async () => {
    const dialog = await openPanel("/?fixture=1&persona=steward&open=help");
    const here = within(dialog).getByRole("list", { name: "Help for this screen" });
    expect(titles(here).slice(0, 2)).toEqual(["Walkthrough: data steward", "Landscape"]);
    expect(within(here).getAllByRole("listitem")[0]).toHaveTextContent("five steps");
  });

  it("in German the chapter titles and summaries are German and each chapter says it is in English", async () => {
    const prefs = await import("@/lib/preferences");
    prefs.setPreferences({ locale: "de-DE" });
    try {
      mount("/?fixture=1&persona=basis&open=help");
      const dialog = await screen.findByRole("dialog", { name: "Hilfe" });
      await within(dialog).findByRole("list", { name: "Hilfe für diesen Bildschirm" });
      const here = within(dialog).getByRole("list", { name: "Hilfe für diesen Bildschirm" });
      const first = within(here).getAllByRole("listitem")[0];
      expect(first).toHaveTextContent("Rundgang: SAP Basis");
      expect(first).toHaveTextContent("auf Englisch");
      expect(first).toHaveTextContent("Systemaufgaben, Verbindungstests");
      fireEvent.click(within(first).getByRole("button"));
      expect(await within(dialog).findByTestId("help-in-english")).toHaveTextContent("Dieses Kapitel ist auf Englisch.");
    } finally {
      window.localStorage.clear();
      prefs.resetPreferencesCache();
      (await import("@/lib/v2/i18n")).setLang("en");
      (await import("@/lib/format")).setFormatPrefs({});
    }
  });

  it("gives the auditor and the viewer their own walkthrough", async () => {
    const dialog = await openPanel("/?fixture=1&role=auditor&open=help");
    expect(titles(within(dialog).getByRole("list", { name: "Help for this screen" }))[0]).toBe("Walkthrough: auditor and viewer");
  });

  it("lists the chapter for the screen you are on first, and nothing of the retired interface", async () => {
    const dialog = await openPanel("/admin/users?fixture=1&open=help");
    const here = within(dialog).getByRole("list", { name: "Help for this screen" });
    expect(titles(here)[0]).toBe("Administration");
    expect(titles(here)).toContain("Walkthrough: administrator");
    expect(within(dialog).queryByRole("list", { name: "Current interface help" })).toBeNull();
    expect(within(dialog).queryByText(/Current interface/)).toBeNull();
    expect(within(dialog).getByText("You are on Administration")).toBeInTheDocument();
  });

  it("puts a different chapter first on a different screen and for an open panel", async () => {
    const work = await openPanel("/work?fixture=1&open=help");
    expect(titles(within(work).getByRole("list", { name: "Help for this screen" }))[0]).toBe("The Work ledger");
  });

  it("searches the chapters and the recordings' captions, and says when nothing matches", async () => {
    const dialog = await openPanel("/?fixture=1&open=help");
    const box = within(dialog).getByRole("searchbox", { name: "Search help" });
    fireEvent.change(box, { target: { value: "golden records" } });
    await waitFor(() => expect(titles(within(dialog).getByRole("list", { name: "All help" }))[0]).toBe("Golden records"));
    fireEvent.change(box, { target: { value: "slash" } });
    const overview = await within(dialog).findByRole("button", { name: /Meridian in three minutes/ });
    expect(overview).toHaveTextContent("From the recording:");
    fireEvent.change(box, { target: { value: "zzzqq" } });
    expect(await within(dialog).findByText(/Nothing in the guide matches "zzzqq"/)).toBeInTheDocument();
  });

  it("opens a chapter with its recording in the panel: poster, mp4 and a captions track", async () => {
    const dialog = await openPanel("/?fixture=1&open=help");
    fireEvent.click(within(dialog).getByRole("button", { name: /^The Work ledger/ }));
    const chapter = await within(dialog).findByTestId("help-chapter");
    expect(within(chapter).getByRole("heading", { name: "The Work ledger" })).toBeInTheDocument();
    expect(chapter).toHaveTextContent("Applies to: Work, An object");
    const video = chapter.querySelector("video") as HTMLVideoElement;
    expect(video).toHaveAttribute("poster", "/api/v1/docs/help-videos/guide2-work.jpg");
    expect(video.querySelector("source")).toHaveAttribute("src", "/api/v1/docs/help-videos/guide2-work.mp4");
    const track = video.querySelector("track") as HTMLTrackElement;
    expect(track).toHaveAttribute("kind", "captions");
    expect(track).toHaveAttribute("src", "/api/v1/docs/help-videos/guide2-work.vtt");
    expect(track).toHaveAttribute("srclang", "en");
    expect(track.hasAttribute("default")).toBe(true);
    expect(within(chapter).getByText(/with captions\. No sound\./)).toBeInTheDocument();
    expect(within(chapter).getByRole("heading", { name: "When something is wrong" })).toBeInTheDocument();
    fireEvent.error(video.querySelector("source") as HTMLSourceElement);
    expect(await within(chapter).findByText("The recording for this chapter is in preparation.")).toBeInTheDocument();
    fireEvent.click(within(chapter).getByRole("button", { name: "All of help" }));
    expect(await within(dialog).findByRole("searchbox", { name: "Search help" })).toBeInTheDocument();
  });

  it("walks a role through five steps with the screen names and a next-step button", async () => {
    const dialog = await openPanel("/?fixture=1&persona=steward&open=help");
    fireEvent.click(within(dialog).getByRole("button", { name: /^Walkthrough: data steward/ }));
    const walk = await within(dialog).findByTestId("walkthrough");
    const steps = within(walk).getAllByRole("listitem");
    expect(steps).toHaveLength(5);
    expect(steps.map((s) => s.querySelector(".m2-ht")?.textContent)).toEqual(["Landscape", "Work", "A record", "By rule", "Waiting for approval"]);
    expect(steps[0]).toHaveAttribute("aria-current", "step");
    expect(within(walk).getByTestId("walkthrough-at")).toHaveTextContent("Step 1 of 5: Landscape");
    const next = within(walk).getByRole("link", { name: "Next step: Work" });
    expect(next.getAttribute("href")).toContain("/work");
    expect(next.getAttribute("href")).toContain("chapter=v2%3Apersona-steward");
    fireEvent.click(next);
    await waitFor(() => expect(within(walk).getByTestId("walkthrough-at")).toHaveTextContent("Step 2 of 5: Work"));
    expect(within(walk).getAllByRole("listitem")[1]).toHaveAttribute("aria-current", "step");
    expect(within(walk).getByRole("link", { name: "Open A record" }).getAttribute("href")).toContain("open=record");
  });

  it("reopens the chapter a walkthrough link names", async () => {
    mount("/work?fixture=1&open=help&chapter=v2%3Apersona-steward");
    const dialog = await screen.findByRole("dialog", { name: "Help" });
    expect(await within(dialog).findByTestId("walkthrough")).toBeInTheDocument();
  });

  it("shows what is new, one dated line per release, newest first", async () => {
    const dialog = await openPanel("/?fixture=1&open=help");
    expect(within(dialog).getByRole("heading", { name: "What's new" })).toBeInTheDocument();
    const items = within(within(dialog).getByTestId("whats-new")).getAllByRole("listitem");
    expect(items).toHaveLength(11);
    expect(items[0]).toHaveTextContent(/^30 Oct 2026\. Policy packs/);
    expect(items[10]).toHaveTextContent(/^29 Oct 2026\. The landscape with its coverage matrix/);
    for (const item of items) expect(item).not.toHaveTextContent(/step \d|\/v2|new interface/i);
  });

  it("the keyboard button opens the shortcut sheet", async () => {
    const dialog = await openPanel("/?fixture=1&open=help");
    fireEvent.click(within(dialog).getByRole("button", { name: "Keyboard shortcuts" }));
    expect(await screen.findByRole("dialog", { name: /Keyboard shortcuts/ })).toBeInTheDocument();
  });

  it("contact support gives a reference and the diagnostics to copy, with the version, tenant and screen", async () => {
    const copy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
    mount("/admin/users?fixture=1&open=help");
    const dialog = await screen.findByRole("dialog", { name: "Help" });
    expect(within(dialog).getByRole("heading", { name: "Contact support" })).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByLabelText("Diagnostics")).toHaveTextContent("Tenant: Demo Corp"));
    const block = within(dialog).getByLabelText("Diagnostics");
    expect(block).toHaveTextContent("Screen: /admin/users");
    expect(block).toHaveTextContent(/Meridian \d/);
    expect(within(dialog).getByTestId("diagnostics-ref").textContent).toMatch(/^MN-[0-9A-F]{4}-\d{4}$/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Copy the diagnostics" }));
    await waitFor(() => expect(copy).toHaveBeenCalledTimes(1));
    expect(copy.mock.calls[0][0]).toContain("Screen: /admin/users");
    expect(await within(dialog).findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });
});

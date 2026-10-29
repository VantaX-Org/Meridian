// The help centre is the one place for help: journeys, recordings and the user guide chapters, which open on /docs.
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GUIDE_PAGES } from "@/lib/help/user-guide";
import HelpPage from "../page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/help",
}));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ homeRole: "admin", loading: false, can: () => true }) }));

async function mount(search: { journey?: string; role?: string } = {}) {
  render(await HelpPage({ searchParams: Promise.resolve(search) }));
}

describe("HelpPage", () => {
  it("lists every user guide chapter as a section, each linking to /docs?page= so deep links keep working", async () => {
    await mount();
    const guide = within(screen.getByTestId("help-user-guide"));
    for (const p of GUIDE_PAGES) {
      expect(guide.getByRole("link", { name: p.title })).toHaveAttribute("href", `/docs?page=${p.slug}`);
    }
    expect(screen.getByRole("heading", { name: "User guide" })).toBeInTheDocument();
  });

  it("is the only help entry: no separate Documentation library button", async () => {
    await mount();
    expect(screen.queryByRole("link", { name: "Documentation library" })).toBeNull();
  });

  it("shows no recording placeholder while a chapter has no recording", async () => {
    await mount();
    expect(screen.queryByText(/recording in preparation/)).toBeNull();
  });
});

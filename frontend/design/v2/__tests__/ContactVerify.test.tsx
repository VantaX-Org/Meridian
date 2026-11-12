import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { resetWorkFixture } from "@/lib/api/v2/fixtures";
import { visibleSections } from "@/lib/v2/admin-sections";
import { AdminCanvas } from "../admin/Admin";
import { setUrl } from "./nav-store";
import { stubLayout } from "./layout-stub";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("@/lib/v2/hooks", async (orig) => {
  const m = await orig<typeof import("@/lib/v2/hooks")>();
  return { ...m, useV2Session: () => ({ persona: "lead", label: "Administrator", name: "Test", email: null, id: "u-me", fixture: true, shared: false, viewAs: null, can: () => true }) };
});

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetWorkFixture();
  undo = stubLayout();
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const page = () => {
  setUrl("/admin/contactverify?fixture=1");
  return renderWithQuery(<AdminCanvas section="contactverify" />);
};

describe("Admin, Contact verification", () => {
  it("is a section for view", () => {
    expect(visibleSections((a) => a === "view").some((s) => s.slug === "contactverify")).toBe(true);
  });

  it("shows each failing record with its own reason and links fixes to cleansing", async () => {
    page();
    const grids = await screen.findAllByRole("table", { name: "Records and why each fails" });
    const text = grids.map((g) => g.textContent ?? "").join(" ");
    expect(text).toContain("Postal code does not match the format of its country");
    expect(text).toContain("sw1a1aa");
    expect(screen.getByRole("link", { name: "Open cleansing" }).getAttribute("href")).toContain("/cleansing");
    expect(screen.getByText(/All .* values pass/)).toBeInTheDocument();
  });

  it("offers the mail server switch", async () => {
    page();
    const sw = await screen.findByLabelText(/^Check that each email domain has a mail server/);
    expect(sw).not.toBeDisabled();
    expect(within(document.body).getByText("Mail server check")).toBeInTheDocument();
  });
});

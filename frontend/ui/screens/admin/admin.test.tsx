import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { AletheiaProvider } from "@/ui/kit";
import { Admin, AdminSectionScreen } from "./Admin";
import { SECTIONS, isSection } from "./sections";
import { isLastAdmin, removeBlock } from "./common";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/n/admin?fixture=1");
});

describe("admin sections", () => {
  it("registers every 11a section with a label, lead and permission", () => {
    for (const slug of ["users", "roles", "apikeys", "signin", "settings", "scoring", "notify", "webhooks", "llm", "licence"]) {
      expect(isSection(slug)).toBe(true);
      const s = SECTIONS[slug];
      expect(s.label()).not.toBe("");
      expect(s.lead()).not.toBe("");
      expect(s.needs.length).toBeGreaterThan(0);
    }
    expect(isSection("nope")).toBe(false);
    expect(isSection("constructor")).toBe(false);
  });

  it("lists the sections in fixture mode", async () => {
    renderWithQuery(<AletheiaProvider><Admin /></AletheiaProvider>);
    expect(await screen.findByRole("heading", { level: 1, name: "Administration" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Users/ }).getAttribute("href")).toBe("/n/admin/users?fixture=1");
  });

  it("answers an unknown section with an empty state", () => {
    renderWithQuery(<AletheiaProvider><AdminSectionScreen slug="nope" /></AletheiaProvider>);
    expect(screen.getByText("There is no such section")).toBeTruthy();
  });
});

describe("removeBlock", () => {
  const admin = { id: "a", role: "admin", is_active: true } as never;
  const other = { id: "b", role: "viewer", is_active: true } as never;
  it("never leaves the tenant without an active administrator", () => {
    expect(isLastAdmin(admin, [admin, other])).toBe(true);
    expect(removeBlock(admin, [admin, other], null)).toBe("last-admin");
    expect(removeBlock(other, [admin, other], null)).toBeNull();
  });
});

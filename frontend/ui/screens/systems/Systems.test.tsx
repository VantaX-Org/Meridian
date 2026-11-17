import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import { AletheiaProvider } from "@/ui/kit";
import { Systems } from "./Systems";
import { System } from "./System";
import { SystemNew } from "./SystemNew";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

let undo: () => void = () => undefined;
const open = (path: string) => window.history.replaceState(null, "", path);
beforeEach(() => { undo = stubLayout(); window.sessionStorage.clear(); });
afterEach(() => undo());

describe("Systems screens (fixture)", () => {
  it("lists connected systems and links to the connect wizard", async () => {
    open("/s?fixture=1");
    renderWithQuery(<AletheiaProvider><Systems /></AletheiaProvider>);
    expect(await screen.findByRole("heading", { level: 1, name: "Systems" })).toBeTruthy();
    expect((await screen.findAllByText(/ECC/)).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Connect a system" }).getAttribute("href")).toContain("/s/new");
  });

  it("shows one system with its section tabs", async () => {
    open("/s/a1b2c3d4-0001-4000-8000-000000000001?fixture=1");
    renderWithQuery(<AletheiaProvider><System id="a1b2c3d4-0001-4000-8000-000000000001" /></AletheiaProvider>);
    expect(await screen.findByRole("heading", { level: 1 })).toBeTruthy();
    for (const name of ["Extractions", "Design", "Configuration", "Pilot", "Reference files", "Custom objects"]) {
      expect(await screen.findByRole("tab", { name })).toBeTruthy();
    }
  });

  it("connect wizard uses masked secret inputs, obvious placeholders and no stored password", async () => {
    open("/s/new?fixture=1");
    const { container } = renderWithQuery(<SystemNew />);
    expect(await screen.findByRole("heading", { level: 1, name: "Connect a system" })).toBeTruthy();
    const pw = container.querySelector('input[type="password"]') as HTMLInputElement | null;
    expect(pw).toBeTruthy();
    expect(pw?.value).toBe("");
    for (const i of Array.from(container.querySelectorAll("input[placeholder]"))) {
      const p = (i as HTMLInputElement).placeholder;
      if (/@|\./.test(p)) expect(p).toContain("example.invalid");
    }
    expect(JSON.stringify(window.localStorage) + JSON.stringify(window.sessionStorage)).not.toMatch(/password/i);
  });
});

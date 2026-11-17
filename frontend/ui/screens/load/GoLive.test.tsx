import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderScreen } from "./test-utils";
import { stubLayout } from "@/ui/testing/layout-stub";
import { GoLive } from "./GoLive";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  undo = stubLayout();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/load/go-live?fixture=1");
});
afterEach(() => undo());

describe("GoLive", () => {
  it("renders its title and real rows in fixture mode", async () => {
    renderScreen(<GoLive />);
    expect(await screen.findByRole("heading", { level: 1, name: "Go-live readiness" })).toBeTruthy();
    expect((await screen.findAllByRole("row")).length).toBeGreaterThan(0);
    expect(document.body.textContent ?? "").not.toContain(String.fromCharCode(0xb7));
  });
});

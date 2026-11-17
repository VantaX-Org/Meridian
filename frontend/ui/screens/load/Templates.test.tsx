import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderScreen } from "./test-utils";
import { stubLayout } from "@/ui/testing/layout-stub";
import { Templates } from "./Templates";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  undo = stubLayout();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/load/templates?fixture=1");
});
afterEach(() => undo());

describe("Templates", () => {
  it("renders its title and real rows in fixture mode", async () => {
    renderScreen(<Templates />);
    expect(await screen.findByRole("heading", { level: 1, name: "Target templates" })).toBeTruthy();
    expect((await screen.findAllByRole("row")).length).toBeGreaterThan(0);
    expect(document.body.textContent ?? "").not.toContain(String.fromCharCode(0xb7));
  });
});

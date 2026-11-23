import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import { AletheiaProvider, ToastHost } from "@/ui/kit";
import { LearnedView } from "./RulesViews";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);
const can = vi.hoisted(() => ({ allowed: true }));
vi.mock("@/ui/screens/orphans/useCan", () => ({ useCan: () => () => can.allowed }));

let undo: () => void = () => undefined;
beforeEach(() => { undo = stubLayout(); can.allowed = true; window.history.replaceState(null, "", "/rules?fixture=1"); });
afterEach(() => undo());

const view = () => renderWithQuery(<AletheiaProvider><ToastHost><LearnedView modules={["material_master"]} /></ToastHost></AletheiaProvider>);

describe("learned rule review and mining", () => {
  it("opens the evidence for a learned rule", async () => {
    view();
    fireEvent.click((await screen.findAllByRole("button", { name: "Review" }))[0]);
    const sheet = within(await screen.findByRole("dialog", { name: "Review learned rule" }));
    expect(await sheet.findByText("Confidence")).toBeTruthy();
    expect(sheet.getByText("Rows backing it")).toBeTruthy();
    expect(sheet.getByText("Rows breaking it")).toBeTruthy();
  });

  it("mines stewards' fixes and says so", async () => {
    view();
    fireEvent.click(await screen.findByRole("button", { name: "Mine stewards' fixes" }));
    expect(await screen.findByText("Stewards' fixes mined. New rules wait for review.")).toBeTruthy();
  });

  it("disables mining with a reason when the role is missing", async () => {
    can.allowed = false;
    view();
    const btn = (await screen.findByRole("button", { name: "Mine stewards' fixes" })) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.getByText("You need the manage rules permission to mine fixes.")).toBeTruthy();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import { AletheiaProvider, ToastHost } from "@/ui/kit";
import { SplitCapped } from "./SplitCapped";

const can = vi.hoisted(() => ({ allowed: true }));
vi.mock("@/ui/screens/orphans/useCan", () => ({ useCan: () => () => can.allowed }));
vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => { undo = stubLayout(); can.allowed = true; window.history.replaceState(null, "", "/run/v1?fixture=1"); });
afterEach(() => undo());

const capped = [{ table: "MARC", rows: 100000, source_rows: 340000 }];
const view = () => renderWithQuery(<AletheiaProvider><ToastHost><SplitCapped systemId="s1" versionId="v1" capped={capped} /></ToastHost></AletheiaProvider>);
const open = async () => {
  view();
  fireEvent.click(screen.getByRole("button", { name: "Split the scope" }));
  return within(await screen.findByRole("dialog", { name: "Split the scope" }));
};

describe("Split a capped run", () => {
  it("renders nothing when no table was capped", () => {
    renderWithQuery(<SplitCapped systemId="s1" versionId="v1" capped={[]} />);
    expect(screen.queryByRole("button", { name: "Split the scope" })).toBeNull();
  });

  it("previews the scopes, then queues one download each after a confirm", async () => {
    const d = await open();
    fireEvent.click(await d.findByRole("button", { name: "Queue the downloads" }, { timeout: 4000 }));
    expect(await screen.findByText(/from SAP once for each of the 2 scopes/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Queue 2 downloads" }));
    expect(await screen.findByText(/2 downloads are queued/)).toBeTruthy();
  });

  it("disables queueing with a reason without the sync permission", async () => {
    can.allowed = false;
    const d = await open();
    const b = (await d.findByRole("button", { name: "Queue the downloads" })) as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    expect(b.title).toBe("You need the sync permission to queue downloads.");
  });
});

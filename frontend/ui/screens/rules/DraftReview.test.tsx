import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import { AletheiaProvider } from "@/ui/kit";
import { DraftsView } from "./RulesViews";
import { RuleFix } from "./RuleFix";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => { undo = stubLayout(); window.history.replaceState(null, "", "/rules?fixture=1"); });
afterEach(() => undo());

describe("draft review", () => {
  it("edits a draft, tries it, then confirms before publishing", async () => {
    renderWithQuery(<AletheiaProvider><DraftsView /></AletheiaProvider>);
    fireEvent.click((await screen.findAllByRole("button", { name: "Review" }))[0]);
    const sheet = within(await screen.findByRole("dialog", { name: "Review draft rule" }));
    const pub = () => sheet.getByRole("button", { name: "Publish" }) as HTMLButtonElement;
    expect(pub().disabled).toBe(true);
    fireEvent.click(sheet.getByRole("button", { name: "Try it on the data" }));
    await sheet.findByRole("status");
    await waitFor(() => expect(pub().disabled).toBe(false));
    fireEvent.click(pub());
    expect(await screen.findByText(/1 rule is created and this draft is removed/)).toBeTruthy();
  });

  it("drafts a new version and shows its changes", async () => {
    renderWithQuery(<AletheiaProvider><RuleFix id="ZR1" scope={{ module: "material_master", tenant_rule: { id: "r1", enabled: true }, versions: [] } as never} /></AletheiaProvider>);
    fireEvent.change(await screen.findByLabelText("Rule definition as JSON"), { target: { value: '{"severity":"high"}' } });
    fireEvent.click(screen.getByRole("button", { name: "Draft the version" }));
    expect(await screen.findByText(/Changes between versions|--- v3/)).toBeTruthy();
  });
});

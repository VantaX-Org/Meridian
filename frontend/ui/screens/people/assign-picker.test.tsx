import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import { AletheiaProvider } from "@/ui/kit";
import { Assignments, OWNER_ROLES, STEWARD_ROLES } from "./Assignments";
import { getTemplate } from "@/lib/api/v2/roles";
import { assignableFixture } from "@/lib/api/v2/fixtures/approvals";
import { resetRolesFixture } from "@/lib/api/v2/fixtures/roles";
import { personLabel } from "@/ui/screens/work/shared";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  undo = stubLayout();
  resetRolesFixture();
  window.history.replaceState(null, "", "/people/assignments?fixture=1");
});
afterEach(() => undo());

const values = (el: HTMLElement): string[] => [...(el as HTMLSelectElement).options].map((o) => o.value).filter(Boolean);

describe("Assignments picker", () => {
  it("offers only owners and stewards by role and saves the named people to the template", async () => {
    renderWithQuery(<AletheiaProvider><Assignments /></AletheiaProvider>);
    const gaps = await screen.findByRole("group", { name: "Gaps" }, { timeout: 5000 });
    const btn = (await within(gaps).findAllByRole("button", { name: "Assign" }))[0] as HTMLButtonElement;
    await waitFor(() => expect(btn.disabled).toBe(false));
    fireEvent.click(btn);
    const owner = await screen.findByRole("combobox", { name: "Owner" });
    const roleOf = new Map(assignableFixture().map((u) => [u.id, u.role ?? ""]));
    await waitFor(() => expect(values(owner).length).toBeGreaterThan(0));
    for (const v of values(owner)) expect(OWNER_ROLES).toContain(roleOf.get(v));
    const steward = screen.getAllByRole("combobox").find((c) => /^Steward/.test(c.getAttribute("aria-label") ?? ""));
    if (!steward) throw new Error("no steward picker");
    expect(values(steward).length).toBeGreaterThan(0);
    for (const v of values(steward)) expect(STEWARD_ROLES).toContain(roleOf.get(v));
    const o = values(owner)[0];
    const s = values(steward)[0];
    fireEvent.change(owner, { target: { value: o } });
    fireEvent.change(steward, { target: { value: s } });
    fireEvent.click(screen.getByRole("button", { name: "Save to the template" }));
    await waitFor(async () => {
      const objs = Object.values((await getTemplate()).template.objects ?? {});
      expect(objs.some((x) => x.owner_user_id === o && x.steward_user_id === s)).toBe(true);
    });
  });
});

describe("personLabel", () => {
  it("adds the email only when another person has the same name", () => {
    const a = { id: "1", name: "J. Smith", email: "j1@x.test" };
    const b = { id: "2", name: "j. smith ", email: "j2@x.test" };
    const c = { id: "3", name: "K. Lee", email: "k@x.test" };
    expect(personLabel(a, [a, b, c])).toBe("J. Smith (j1@x.test)");
    expect(personLabel(c, [a, b, c])).toBe("K. Lee");
    expect(personLabel({ id: "4", name: "K. Lee" }, [c, { id: "4", name: "K. Lee" }])).toBe("K. Lee");
  });
});

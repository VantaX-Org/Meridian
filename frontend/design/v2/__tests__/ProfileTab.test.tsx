import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { resetProfileFixture } from "@/lib/api/v2/fixtures/profile";
import { ProfileTab } from "../screens/object/ProfileTab";
import { setUrl } from "./nav-store";
import { stubLayout } from "./layout-stub";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

let granted: string[] | "all" = "all";
vi.mock("@/lib/v2/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/v2/hooks")>();
  return {
    ...actual,
    useV2Session: () => ({ persona: "lead" as const, label: "Programme lead", name: "Test", email: null, fixture: true, can: (a: string) => granted === "all" || granted.includes(a) }),
  };
});

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  window.localStorage.clear();
  granted = "all";
  resetProfileFixture();
  undo = stubLayout();
  setUrl("/o/ecc-production/material-master/profile?fixture=1");
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const norm = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
const tab = (module = "material-master") => renderWithQuery(<ProfileTab system="ecc-production" module={module} />);

describe("the Profile tab", () => {
  it("profiles each table's fields with their dictionary text", async () => {
    tab();
    const mara = await screen.findByRole("table", { name: "Field profile of MARA" });
    const rows = within(mara).getAllByRole("row").slice(1);
    expect(rows.length).toBeGreaterThan(3);
    expect(norm(rows[0])).toContain("MATNR");
    expect(rows.some((r) => /MTART.*Material type/.test(norm(r)))).toBe(true);
    expect(norm(screen.getByTestId("profile-sentence"))).toMatch(/2 mined dependencies are not yet a rule\.$/);
  });

  it("withholds the values of a masked field", async () => {
    tab();
    const makt = await screen.findByRole("table", { name: "Field profile of MAKT" });
    const row = within(makt).getAllByRole("row").find((r) => norm(r).startsWith("MAKTX"));
    expect(row).toBeDefined();
    const cells = within(row as HTMLElement).getAllByRole("cell");
    expect(norm(cells[cells.length - 1])).toBe("—");
  });

  it("turns a mined dependency into a rule", async () => {
    tab();
    await screen.findByRole("table", { name: "Mined dependencies" });
    const first = screen.getAllByTestId("dependency")[0];
    expect(norm(first)).toContain("MARA-MTART Material type");
    fireEvent.click(within(first).getByRole("button", { name: "Make it a rule" }));
    await screen.findByText(/^Rule HR-[^ ]+ added\. It runs from the next analysis\.$/);
    await waitFor(() => expect(norm(screen.getAllByTestId("dependency")[0])).toContain("Checked every run"));
    expect(norm(screen.getByTestId("profile-sentence"))).toMatch(/1 mined dependency is not yet a rule\.$/);
  });

  it("offers no rule button without the right to manage rules", async () => {
    granted = [];
    tab();
    await screen.findByRole("table", { name: "Mined dependencies" });
    expect(screen.queryByRole("button", { name: "Make it a rule" })).toBeNull();
  });

  it("says so when the run did not profile the object", async () => {
    tab("business-partner");
    expect(await screen.findByText(/^This run did not profile/)).toBeInTheDocument();
  });
});

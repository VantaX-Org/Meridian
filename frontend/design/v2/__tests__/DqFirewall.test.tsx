import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
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

const norm = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
const page = () => {
  setUrl("/admin/dqfirewall?fixture=1");
  return renderWithQuery(<AdminCanvas section="dqfirewall" />);
};

describe("Admin, Data quality firewall", () => {
  it("is a section for manage_settings", () => {
    expect(visibleSections((a) => a === "manage_settings").some((s) => s.slug === "dqfirewall")).toBe(true);
    expect(visibleSections((a) => a === "view").some((s) => s.slug === "dqfirewall")).toBe(false);
  });

  it("shows the endpoint, the sample call and the calls count", async () => {
    page();
    expect(await screen.findByText("POST /api/v1/dq-firewall/validate")).toBeInTheDocument();
    const curl = await screen.findByLabelText("Sample call");
    expect(norm(curl)).toContain("curl -X POST");
    expect(norm(curl)).toContain("/api/v1/dq-firewall/validate");
    await waitFor(() => expect(screen.getByText("Calls in the last 24 hours").parentElement?.textContent).toContain("3"));
  });

  it("blocks a record with a blank material type and says which rule and why", async () => {
    page();
    fireEvent.click(await screen.findByRole("button", { name: "Check records" }));
    const grid = await screen.findByRole("grid", { name: "Failing rules" });
    await waitFor(() => expect(norm(grid)).toContain("MM003"));
    expect(norm(grid)).toContain("Material type is mandatory");
    expect(norm(grid)).toContain("MARA.MTART");
    expect(screen.getByRole("status").textContent).toContain("Blocked");
    expect(screen.getByRole("status").textContent).toContain("1 of 2 records blocked");
  });

  it("explains bad JSON without calling the endpoint", async () => {
    page();
    const box = await screen.findByLabelText("Records, as JSON");
    fireEvent.change(box, { target: { value: "{not json" } });
    fireEvent.click(screen.getByRole("button", { name: "Check records" }));
    expect(await screen.findByText(/must be a JSON list of objects/)).toBeInTheDocument();
  });
});

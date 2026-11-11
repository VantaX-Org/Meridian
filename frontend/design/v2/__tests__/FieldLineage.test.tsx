import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { FieldLineagePanel } from "../screens/object/FieldLineage";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  setUrl("/o/ecc-production/material-master/lineage?fixture=1");
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const panel = () => renderWithQuery(<FieldLineagePanel module="material_master" labelOf={(m) => (m === "material_master" ? "Material master" : m)} />);

describe("the field lineage panel", () => {
  it("shows table, field, business term, check table, owner and rule count", async () => {
    panel();
    const row = await screen.findByTestId("fl-MARA-MTART");
    expect(within(row).getByText("Material type")).toBeInTheDocument();
    expect(within(row).getByText("T134")).toBeInTheDocument();
    expect(within(row).getByText("Configuration")).toBeInTheDocument();
    expect(row.textContent).toContain("15");
  });

  it("links each rule to the rule inspector", async () => {
    panel();
    const row = await screen.findByTestId("fl-MARA-MTART");
    expect(within(row).getByRole("link", { name: "MM003" }).getAttribute("href")).toContain("open=rule%3AMM003");
  });

  it("filters by field, and says when nothing matches", async () => {
    panel();
    await screen.findByTestId("fl-MARA-MTART");
    fireEvent.change(screen.getByTestId("field-lineage-filter"), { target: { value: "mtart" } });
    expect(screen.getByTestId("fl-MARA-MTART")).toBeInTheDocument();
    expect(screen.queryByTestId("fl-MARA-BRGEW")).toBeNull();
    fireEvent.change(screen.getByTestId("field-lineage-filter"), { target: { value: "no-such-field-x" } });
    expect(screen.getByText("No field matches that filter.")).toBeInTheDocument();
  });
});

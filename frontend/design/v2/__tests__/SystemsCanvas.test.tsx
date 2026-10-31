import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import type { SAPSystemExtended } from "@/types/api";
import { SystemsCanvas } from "../screens/system/SystemsCanvas";
import { setUrl } from "./nav-store";

const h = vi.hoisted(() => ({ data: [] as unknown[] }));
vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/lib/v2/runs-queries", async (orig) => {
  const m = await orig<typeof import("@/lib/v2/runs-queries")>();
  return { ...m, useSystemsExtended: () => ({ data: h.data, isLoading: false, isError: false, refetch: vi.fn() }) };
});

const sys = (o: Partial<SAPSystemExtended>) => ({ id: "x", name: "X", system_type: "s4hana", environment: "prod", role: "source", health_status: "healthy", health_message: null, last_sync_at: null, last_sync_status: null, sap_release: null, ...o }) as SAPSystemExtended;

beforeEach(() => setUrl("/s"));

describe("SystemsCanvas", () => {
  it("draws sources and targets, flags the unhealthy row with its message, and links the row to the inspector", () => {
    h.data = [
      sys({ id: "a", name: "ECC Prod" }),
      sys({ id: "b", name: "S4 Target", role: "target", health_status: "auth_failed", health_message: "Password expired" }),
    ];
    renderWithQuery(<SystemsCanvas />);
    const map = screen.getByRole("img", { name: /feed Meridian/ });
    expect(within(map).getByText("ECC Prod")).toBeInTheDocument();
    expect(within(map).getByText("S4 Target")).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Connection health" });
    const bad = within(list).getByText("S4 Target").closest("a")!;
    expect(bad).toHaveTextContent("Sign-in failed");
    expect(bad).toHaveTextContent("Password expired");
    expect(bad.getAttribute("href")).toContain("open=system%3Ab");
  });

  it("offers to connect a system when none exists", () => {
    h.data = [];
    renderWithQuery(<SystemsCanvas />);
    expect(screen.getByText("No system is connected yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect a system" })).toBeInTheDocument();
  });
});

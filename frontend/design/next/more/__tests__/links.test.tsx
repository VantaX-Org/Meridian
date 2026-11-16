import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import type { RecordLink } from "@/lib/api/v2/links";
import { Links } from "../Links";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

const Q = vi.hoisted(() => ({ err: null as unknown, calls: [] as unknown[] }));

const row = (id: string, over: Partial<RecordLink> = {}): RecordLink => ({
  id, from_domain: "business_partner", from_key: "BP1", to_domain: "customer_master", to_key: "C1",
  relationship_type: "bp_is_customer", sap_link_table: "CVI_CUST_LINK", discovered_at: "2026-11-01T00:00:00Z",
  active: true, ai_inferred: false, ai_confidence: null, impact_score: null, ...over,
});

vi.mock("@/lib/api/v2/links", async (orig) => ({
  ...(await orig<object>()),
  getLinks: (q: unknown) => {
    Q.calls.push(q);
    return Q.err ? Promise.reject(Q.err) : Promise.resolve({ relationships: [row("l1"), row("l2", { ai_inferred: true, ai_confidence: 0.8, active: false })], total: 300 });
  },
  getLinkTypes: () => Promise.resolve([{ id: "t1", from_table: "BUT000", to_table: "KNA1", relationship_type: "bp_is_customer", description: null }]),
}));

beforeEach(() => {
  setUrl("/more/master-data?tab=links&fixture=1");
  Q.err = null;
  Q.calls = [];
});

describe("Record links", () => {
  it("shows the banner, the rows and the link types", async () => {
    renderWithQuery(<Links />);
    expect(await screen.findByTestId("links-banner")).toHaveTextContent("300 records linked across objects");
    expect(screen.getByTestId("links-banner")).toHaveTextContent("The lists show the latest 200");
    expect(screen.getByTestId("link-l1")).toBeInTheDocument();
    expect(screen.getByTestId("links-table")).toHaveTextContent("CVI_CUST_LINK");
    expect(screen.getByTestId("links-table")).toHaveTextContent("Ended");
    expect(screen.getByTestId("links-table")).toHaveTextContent("Inferred");
    expect(await screen.findByText("KNA1")).toBeInTheDocument();
  });
  it("searches one record", async () => {
    renderWithQuery(<Links />);
    const form = await screen.findByTestId("links-search");
    fireEvent.change(form.querySelector("select")!, { target: { value: "business_partner" } });
    fireEvent.change(form.querySelector("input.nx-input")!, { target: { value: " BP1 " } });
    fireEvent.click(screen.getByRole("button", { name: "Show links" }));
    await waitFor(() => expect(Q.calls).toContainEqual({ domain: "business_partner", key: "BP1", include_inactive: false }));
  });
  it("says when the role cannot read", async () => {
    Q.err = { response: { status: 403 } };
    renderWithQuery(<Links />);
    expect(await screen.findByText("Your role cannot read the record links.")).toBeInTheDocument();
  });
  it("retries after an error", async () => {
    Q.err = new Error("down");
    renderWithQuery(<Links />);
    expect(await screen.findByText("The record links could not be read.", {}, { timeout: 4000 })).toBeInTheDocument();
    Q.err = null;
    fireEvent.click(screen.getByRole("button", { name: /retry|try again/i }));
    expect(await screen.findByTestId("links-banner")).toBeInTheDocument();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import * as api from "@/lib/api/v2/links";
import { ToastProvider } from "../../../kit";
import { RecordLinks } from "../Links";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

const wrap = () => renderWithQuery(<ToastProvider><RecordLinks /></ToastProvider>);
beforeEach(() => { setUrl("/more?fixture=1"); window.sessionStorage.setItem("mn_v2_fixture", "1"); });
afterEach(() => { window.sessionStorage.clear(); vi.restoreAllMocks(); });

describe("Record links (native)", () => {
  it("renders the fixture links with text beside each code", async () => {
    wrap();
    expect((await screen.findByTestId("links-banner")).textContent).toMatch(/records linked across objects/);
    const table = screen.getByTestId("links-table");
    expect(within(table).getAllByText("Business partner is a customer").length).toBeGreaterThan(0);
    expect(within(table).getAllByText("bp_is_customer").length).toBeGreaterThan(0);
    expect(await screen.findByTestId("links-known")).toHaveTextContent("BUT000");
  });

  it("searches one object and includes ended links", async () => {
    wrap();
    await screen.findByTestId("links-banner");
    const form = screen.getByTestId("links-search");
    const spy = vi.spyOn(api, "getLinks");
    fireEvent.change(within(form).getByRole("combobox"), { target: { value: "business_partner" } });
    fireEvent.click(within(form).getByRole("checkbox"));
    fireEvent.submit(form);
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ domain: "business_partner", key: "", include_inactive: true }));
    expect(await within(screen.getByTestId("links-table")).findByText("Ended")).toBeInTheDocument();
  });

  it("says the role cannot read the links on 403", async () => {
    vi.spyOn(api, "getLinks").mockRejectedValue({ response: { status: 403 } });
    wrap();
    expect(await screen.findByText("Your role cannot read the record links.")).toBeInTheDocument();
  });
});

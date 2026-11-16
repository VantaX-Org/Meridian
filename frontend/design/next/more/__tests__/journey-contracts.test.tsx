import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { ToastProvider } from "../../kit";
import type { SheetCtx } from "../../shell/SheetHost";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

const Q = vi.hoisted(() => ({ can: (() => true) as (a: string) => boolean, shared: false }));
vi.mock("@/lib/v2/hooks", async (orig) => ({ ...(await orig<object>()), useV2Session: () => ({ can: Q.can, id: "me", name: "Me", email: "me@example.com", persona: "admin", label: "Admin", fixture: true, viewAs: null, shared: Q.shared }) }));

const wrap = (ui: React.ReactElement) => renderWithQuery(<ToastProvider>{ui}</ToastProvider>);
const ctxOf = (id = ""): SheetCtx => ({ id, step: 0, setStep: vi.fn(), close: vi.fn(), dismiss: vi.fn(), open: vi.fn(), under: false }) as unknown as SheetCtx;

beforeEach(() => {
  setUrl("/more?fixture=1");
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  Q.can = () => true;
  Q.shared = false;
});
import { ContractSheet, ContractsSheet } from "../Contracts";

describe("Data contracts (next)", () => {
  it("lists the contracts and creates a draft, then opens it", async () => {
    const ctx = ctxOf();
    wrap(<ContractsSheet ctx={ctx} />);
    await waitFor(() => expect(within(screen.getByTestId("contracts-list")).getByText("Material master to S/4HANA")).toBeTruthy());
    const form = screen.getByTestId("contract-form");
    fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "Customer master to CRM" } });
    fireEvent.change(within(form).getByLabelText("Producer (object)"), { target: { value: "customer_master" } });
    fireEvent.change(within(form).getByLabelText("Consumer"), { target: { value: "CRM" } });
    fireEvent.click(within(form).getByRole("button", { name: "Create a draft" }));
    await waitFor(() => expect(ctx.open).toHaveBeenCalledWith(expect.objectContaining({ kind: "contract" })));
  });

  it("shows one contract with its facts and versions", async () => {
    wrap(<ContractSheet ctx={ctxOf("ct-1")} />);
    await waitFor(() => expect(screen.getByTestId("contract-facts")).toBeTruthy());
    expect(screen.getByTestId("contract-versions")).toBeTruthy();
  });

  it("hides the create form without the manage rules permission", async () => {
    Q.can = (a) => a !== "manage_rules";
    wrap(<ContractsSheet ctx={ctxOf()} />);
    await waitFor(() => expect(screen.getByText("Creating a contract needs the manage rules permission.")).toBeTruthy());
    expect(screen.queryByTestId("contract-form")).toBeNull();
  });
});

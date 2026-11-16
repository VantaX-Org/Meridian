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
import { FieldMappingsSheet } from "../FieldMappings";

describe("Field mappings (next)", () => {
  it("lists the mappings and opens one", async () => {
    const ctx = ctxOf();
    wrap(<FieldMappingsSheet ctx={ctx} />);
    await waitFor(() => expect(within(screen.getByTestId("mappings-list")).getAllByRole("button", { name: "Open" }).length).toBeGreaterThan(0));
    fireEvent.click(within(screen.getByTestId("mappings-list")).getAllByRole("button", { name: "Open" })[0]);
    expect(ctx.open).toHaveBeenCalledWith(expect.objectContaining({ kind: "field-mappings" }));
    expect(screen.getByRole("button", { name: "Add a mapping" })).toBeTruthy();
  });

  it("shows one mapping with its facts", async () => {
    wrap(<FieldMappingsSheet ctx={ctxOf("fm-1")} />);
    await waitFor(() => expect(screen.getByTestId("mapping-facts")).toBeTruthy());
  });

  it("is read only without the manage field mappings permission", async () => {
    Q.can = (a) => a !== "manage_field_mappings";
    wrap(<FieldMappingsSheet ctx={ctxOf()} />);
    await waitFor(() => expect(screen.getByTestId("mappings-readonly")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Add a mapping" })).toBeNull();
  });
});

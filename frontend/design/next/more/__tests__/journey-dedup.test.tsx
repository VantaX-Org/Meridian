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
import { DedupSheet } from "../Dedup";

describe("Duplicate records to merge (next)", () => {
  it("lists the pairs and opens one", async () => {
    const ctx = ctxOf();
    wrap(<DedupSheet ctx={ctx} />);
    await waitFor(() => expect(within(screen.getByTestId("dedup-list")).getAllByRole("button", { name: "Compare and merge" }).length).toBeGreaterThan(0));
    fireEvent.click(within(screen.getByTestId("dedup-list")).getAllByRole("button", { name: "Compare and merge" })[0]);
    expect(ctx.open).toHaveBeenCalledWith(expect.objectContaining({ kind: "dedup" }));
  });

  it("hides the merge form without the approve permission", async () => {
    Q.can = (a) => a !== "approve";
    wrap(<DedupSheet ctx={ctxOf("dd-1")} />);
    await waitFor(() => expect(screen.getByTestId("dedup-merge")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Merge" })).toBeNull();
  });

  it("merges a pair with a reason", async () => {
    const ctx = ctxOf("dd-1");
    wrap(<DedupSheet ctx={ctx} />);
    await waitFor(() => expect(screen.getByTestId("dedup-merge")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Why are these the same record?"), { target: { value: "Same tax number" } });
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    await waitFor(() => expect(ctx.open).toHaveBeenCalledWith({ kind: "dedup", id: "" }));
  });
});

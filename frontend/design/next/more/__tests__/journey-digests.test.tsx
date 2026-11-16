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
import { DigestsSheet } from "../Digests";

describe("Digests (next)", () => {
  it("lists the digests and starts a new one", async () => {
    const ctx = ctxOf();
    wrap(<DigestsSheet ctx={ctx} />);
    await waitFor(() => expect(within(screen.getByTestId("digests-list")).getByText("Monday leadership digest")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Add a digest" }));
    expect(ctx.open).toHaveBeenCalledWith({ kind: "digests", id: "new" });
  });

  it("shows one digest with its facts and preview", async () => {
    wrap(<DigestsSheet ctx={ctxOf("dg-1")} />);
    await waitFor(() => expect(screen.getByTestId("digest-facts")).toBeTruthy());
  });

  it("denies the screen without a digest permission", async () => {
    Q.can = (a) => a !== "manage_settings" && a !== "manage_digests";
    wrap(<DigestsSheet ctx={ctxOf()} />);
    expect(screen.getByTestId("denied")).toBeTruthy();
    expect(screen.queryByTestId("digests-list")).toBeNull();
  });
});

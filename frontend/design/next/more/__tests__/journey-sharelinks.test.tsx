import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { ToastProvider } from "../../kit";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

const Q = vi.hoisted(() => ({ can: (() => true) as (a: string) => boolean, shared: false }));
vi.mock("@/lib/v2/hooks", async (orig) => ({ ...(await orig<object>()), useV2Session: () => ({ can: Q.can, id: "me", name: "Me", email: "me@example.com", persona: "admin", label: "Admin", fixture: true, viewAs: null, shared: Q.shared }) }));

const wrap = (ui: React.ReactElement) => renderWithQuery(<ToastProvider>{ui}</ToastProvider>);

beforeEach(() => {
  setUrl("/more?fixture=1");
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  Q.can = () => true;
  Q.shared = false;
});
import { ShareLinks } from "../ShareLinks";

describe("Share links (next)", () => {
  it("revokes a live link behind a confirm", async () => {
    wrap(<ShareLinks />);
    await waitFor(() => expect(screen.getByTestId("share-links")).toBeTruthy());
    fireEvent.click(within(screen.getByTestId("share-links")).getAllByRole("button", { name: "Revoke" })[0]);
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("keeps revoke off in a shared view", async () => {
    Q.shared = true;
    wrap(<ShareLinks />);
    await waitFor(() => expect(screen.getByTestId("share-links")).toBeTruthy());
    for (const b of within(screen.getByTestId("share-links")).queryAllByRole("button", { name: "Revoke" })) expect(b.getAttribute("aria-disabled") === "true" || (b as HTMLButtonElement).disabled).toBe(true);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
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
import { Collab } from "../Collab";

describe("Watch and comments (next)", () => {
  it("shows the comments on a record and posts one", async () => {
    wrap(<Collab kind="record" id="material_master:MATNR=000000000000000100" label="Material 100" />);
    await waitFor(() => expect(screen.getAllByTestId("comment").length).toBe(1));
    expect(screen.getByTestId("watch")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Add a comment"), { target: { value: "Unit fixed in plant 3000." } });
    fireEvent.click(screen.getByRole("button", { name: "Post comment" }));
    await waitFor(() => expect(screen.getAllByTestId("comment").length).toBe(2));
  });

  it("keeps comments read only in a shared view", async () => {
    Q.shared = true;
    wrap(<Collab kind="rule" id="MM142" label="MM142" />);
    await waitFor(() => expect(screen.getAllByTestId("comment").length).toBe(1));
    expect(screen.queryByRole("button", { name: "Post comment" })).toBeNull();
  });
});

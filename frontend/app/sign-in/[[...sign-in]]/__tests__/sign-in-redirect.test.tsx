// After sign-in the user goes to /home, which picks the landing page once /me/permissions is loaded.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ push: vi.fn(), search: "" }));
const auth = vi.hoisted(() => ({ login: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/sign-in",
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ login: auth.login, user: null, logout: vi.fn() }) }));

import SignInPage from "../page";

async function signIn() {
  render(<SignInPage />);
  fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "sam@x.io" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  await waitFor(() => expect(nav.push).toHaveBeenCalledTimes(1));
  return nav.push.mock.calls[0]?.[0];
}

describe("sign-in redirect", () => {
  beforeEach(() => {
    nav.push.mockReset();
    auth.login.mockReset();
    window.history.replaceState(null, "", "/sign-in");
  });

  it("sends a steward to /home, not straight to Fix work, so their grants decide the landing page", async () => {
    auth.login.mockResolvedValue({ id: "u1", email: "sam@x.io", name: "Sam", role: "data_steward", permissions: [] });
    expect(await signIn()).toBe("/home");
  });

  it("keeps a safe ?next= target", async () => {
    window.history.replaceState(null, "", "/sign-in?next=/objects");
    auth.login.mockResolvedValue({ id: "u1", email: "sam@x.io", name: "Sam", role: "admin", permissions: [] });
    expect(await signIn()).toBe("/objects");
  });

  it("ignores an off-site ?next=", async () => {
    window.history.replaceState(null, "", "/sign-in?next=//evil.example");
    auth.login.mockResolvedValue({ id: "u1", email: "sam@x.io", name: "Sam", role: "admin", permissions: [] });
    expect(await signIn()).toBe("/home");
  });
});

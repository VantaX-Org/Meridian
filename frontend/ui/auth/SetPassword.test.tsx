// Setting a password from an invite or reset link signs straight in; a refused sign-in falls back to the sign-in page.
import { fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
const login = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams("token=tok"),
}));
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ login }) }));

import { SetPasswordForm } from "./SetPassword";

function fill(container: HTMLElement) {
  const [pw, confirm] = Array.from(container.querySelectorAll("input"));
  fireEvent.change(pw, { target: { value: "a-long-password" } });
  fireEvent.change(confirm, { target: { value: "a-long-password" } });
  fireEvent.submit(container.querySelector("form")!);
}

function renderForm(submit: (token: string, password: string) => Promise<{ email: string }>) {
  return render(
    <SetPasswordForm title="Join" lead="lead" submitLabel="Accept" missingToken="missing" failure="failed"
      redirect="/sign-in?invited=1" submit={submit} />,
  );
}

describe("SetPasswordForm", () => {
  beforeEach(() => { replace.mockReset(); login.mockReset(); });

  it("signs in with the chosen password and opens the app", async () => {
    const submit = vi.fn().mockResolvedValue({ ok: true, email: "ann@example.com" });
    login.mockResolvedValue({});
    const { container } = renderForm(submit);
    fill(container);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(submit).toHaveBeenCalledWith("tok", "a-long-password");
    expect(login).toHaveBeenCalledWith("ann@example.com", "a-long-password");
  });

  it("falls back to the sign-in page with the email filled in when sign-in is refused", async () => {
    const submit = vi.fn().mockResolvedValue({ ok: true, email: "ann+x@example.com" });
    login.mockRejectedValue(new Error("sso enforced"));
    const { container } = renderForm(submit);
    fill(container);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sign-in?invited=1&email=ann%2Bx%40example.com"));
  });

  it("shows the server's refusal and does not sign in when the token is rejected", async () => {
    const submit = vi.fn().mockRejectedValue({ response: { data: { detail: "Invite expired" } } });
    const { container, findByText } = renderForm(submit);
    fill(container);
    await findByText("Invite expired");
    expect(login).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});

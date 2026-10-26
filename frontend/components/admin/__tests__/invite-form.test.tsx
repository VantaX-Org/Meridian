import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { renderWithQuery } from "@/__tests__/render";
import { inviteUser } from "@/lib/api/users";

const ROLE = vi.hoisted(() => ({ description: null, built_in: true, legacy: false, cloned_from: null, updated_at: null, users: 0 }));
vi.mock("@/lib/api/roles", () => ({
  listRoles: vi.fn().mockResolvedValue([
    { ...ROLE, key: "platform_admin", name: "Platform admin" },
    { ...ROLE, key: "data_steward", name: "Data steward" },
    { ...ROLE, key: "admin", name: "Admin (legacy)", legacy: true },
  ]),
}));
vi.mock("@/lib/api/connectivity", () => ({ getSystems: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/api/users", () => ({ inviteUser: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../grants-picker", () => ({
  GrantsPicker: ({ onAdd }: { onAdd: (g: { role_key: string }) => void }) => (
    <button type="button" onClick={() => onAdd({ role_key: "data_steward" })}>Add grant</button>
  ),
}));

import { InviteForm } from "../invite-form";

describe("InviteForm", () => {
  it("rejects an invalid email inline and keeps the submit disabled", () => {
    renderWithQuery(<InviteForm onDone={() => {}} />);
    const email = screen.getByLabelText("Email");
    fireEvent.change(email, { target: { value: "not-an-email" } });
    fireEvent.blur(email);
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Enter a valid email address")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send invitation" })).toBeDisabled();
  });

  it("shows the required message when the email is left empty", () => {
    renderWithQuery(<InviteForm onDone={() => {}} />);
    const email = screen.getByLabelText("Email");
    fireEvent.blur(email);
    expect(screen.getByText("Enter an email address")).toBeInTheDocument();
  });

  it("refreshes the users and access-request lists once the invite is sent", async () => {
    vi.mocked(inviteUser).mockResolvedValue({ id: "u9", email: "new@example.test", role: "viewer", status: "invited" } as Awaited<ReturnType<typeof inviteUser>>);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const onDone = vi.fn();
    render(<QueryClientProvider client={qc}><InviteForm onDone={onDone} /></QueryClientProvider>);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Add grant" }));
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    // Roles only as grants: no role field on the invite.
    expect(vi.mocked(inviteUser).mock.calls[0]?.[0]).toEqual({
      email: "new@example.test", name: undefined, grants: [{ role_key: "data_steward", system_id: null, module: null }],
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["users"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["access-requests"] });
  });

  it("lets the admin choose any persona role at invite, sent as one unscoped grant", async () => {
    vi.mocked(inviteUser).mockClear();
    vi.mocked(inviteUser).mockResolvedValue({ id: "u10", email: "lead@example.test", role: "platform_admin", status: "invited" } as Awaited<ReturnType<typeof inviteUser>>);
    const user = userEvent.setup();
    const onDone = vi.fn();
    renderWithQuery(<InviteForm onDone={onDone} />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "lead@example.test" } });
    expect(screen.getByRole("button", { name: "Send invitation" })).toBeDisabled();
    await user.click(screen.getByRole("combobox", { name: "Role" }));
    const offered = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(offered).toEqual(["Platform admin", "Data steward"]);
    await user.click(screen.getByRole("option", { name: "Platform admin" }));
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(vi.mocked(inviteUser).mock.calls[0]?.[0]).toEqual({
      email: "lead@example.test", name: undefined, grants: [{ role_key: "platform_admin", system_id: null, module: null }],
    });
  });
});

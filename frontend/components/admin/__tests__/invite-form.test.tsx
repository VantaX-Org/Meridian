import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderWithQuery } from "@/__tests__/render";
import { inviteUser } from "@/lib/api/users";

vi.mock("@/lib/api/roles", () => ({ listRoles: vi.fn().mockResolvedValue([]) }));
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
});

import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";

vi.mock("@/lib/api/roles", () => ({ listRoles: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/api/connectivity", () => ({ getSystems: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/api/users", () => ({ inviteUser: vi.fn() }));
vi.mock("../grants-picker", () => ({ GrantsPicker: () => null }));

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
});

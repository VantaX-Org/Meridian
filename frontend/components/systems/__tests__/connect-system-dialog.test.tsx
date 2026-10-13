import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as systemsApi from "@/lib/api/systems";
import { ConnectSystemDialog } from "../connect-system-dialog";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const type = (label: string, value: string) => {
  const input = screen.getByLabelText(label);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};

beforeEach(() => vi.restoreAllMocks());

describe("ConnectSystemDialog", () => {
  it("keeps Connect disabled and shows inline errors for invalid RFC input", () => {
    renderWithQuery(<ConnectSystemDialog open onOpenChange={() => {}} />);
    const submit = screen.getByRole("button", { name: "Connect system" });
    expect(submit).toBeDisabled();
    // untouched: no wall of red
    expect(screen.queryByText("Enter a system name")).not.toBeInTheDocument();

    type("Name", "");
    expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Enter a system name")).toBeInTheDocument();

    type("Client", "12");
    expect(screen.getByText("Enter a 3-digit client")).toBeInTheDocument();
    type("Instance number", "1");
    expect(screen.getByText("Enter a 2-digit instance number")).toBeInTheDocument();
    expect(submit).toBeDisabled();
  });

  it("does not offer Ariba: the form cannot collect its API key and token URL", () => {
    renderWithQuery(<ConnectSystemDialog open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("combobox", { name: "Type" }));
    expect(screen.queryByRole("option", { name: "Ariba" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("option").length).toBeGreaterThan(1);
  });

  it("registers the system with its credentials once valid", async () => {
    const register = vi.spyOn(systemsApi, "registerSystem").mockResolvedValue({ id: "s1", name: "ECC Prod" } as Awaited<ReturnType<typeof systemsApi.registerSystem>>);
    const onOpenChange = vi.fn();
    renderWithQuery(<ConnectSystemDialog open onOpenChange={onOpenChange} />);
    type("Name", "ECC Prod");
    type("Host", "ecc.internal");
    type("Client", "100");
    type("Instance number", "00");
    type("Password", "s3cret");
    const submit = screen.getByRole("button", { name: "Connect system" });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);
    await waitFor(() => expect(register).toHaveBeenCalledOnce());
    expect(register.mock.calls[0]![0]).toMatchObject({
      name: "ECC Prod", system_type: "ecc", environment: "DEV", host: "ecc.internal", client: "100", sysnr: "00",
      auth_type: "rfc", credentials: { password: "s3cret" },
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});

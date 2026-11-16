// frontend/design/next/shell/__tests__/requestaccess.test.tsx
// The native request-access sheet sends the refused access, its scope and the optional reason to POST /access-requests.
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createAccessRequest = vi.fn();
vi.mock("@/lib/api/me", () => ({ createAccessRequest: (...a: unknown[]) => createAccessRequest(...a) }));

import { RequestAccessDialog } from "../RequestAccess";

function mount(onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <RequestAccessDialog target={{ resource: "rules", action: "approve", system_id: "s1", module: "material_master", systemLabel: "KMP" }} onClose={onClose} />
    </QueryClientProvider>,
  );
  return onClose;
}

beforeEach(() => { createAccessRequest.mockReset(); });

describe("RequestAccessDialog", () => {
  it("draws nothing without a target", () => {
    const { container } = render(<RequestAccessDialog target={null} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("sends the request with the reason, then offers Done", async () => {
    createAccessRequest.mockResolvedValue({ id: "r1" });
    const onClose = mount();
    expect(screen.getByText(/KMP/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Reason (optional)"), { target: { value: "  wave 2 sign-off  " } });
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    expect(await screen.findByText("Request sent to the administrators")).toBeInTheDocument();
    expect(createAccessRequest).toHaveBeenCalledWith({ resource: "rules", action: "approve", system_id: "s1", module: "material_master", reason: "wave 2 sign-off" });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows a failure and keeps the form", async () => {
    createAccessRequest.mockRejectedValue(Object.assign(new Error("Request failed with status code 500"), { isAxiosError: true, response: { status: 500, data: {} } }));
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    expect(await screen.findByText("The request was not sent")).toBeInTheDocument();
    expect(screen.getByText("Try again in a minute.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send request" })).toBeInTheDocument();
  });
});

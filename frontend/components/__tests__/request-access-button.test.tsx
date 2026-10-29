import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RequestAccessButton } from "../request-access-button";

const ctx = vi.hoisted(() => ({ value: null as null | { loading: boolean; requestAccess: (t: unknown) => void } }));
vi.mock("@/lib/permissions", () => ({ usePermissionsContext: () => ctx.value }));

beforeEach(() => { ctx.value = null; });

describe("RequestAccessButton", () => {
  it("opens the request dialog for its resource and action", async () => {
    const requestAccess = vi.fn();
    ctx.value = { loading: false, requestAccess };
    render(<RequestAccessButton resource="rules" action="edit" />);
    await userEvent.click(screen.getByRole("button", { name: "Request access" }));
    expect(requestAccess).toHaveBeenCalledWith({ resource: "rules", action: "edit" });
  });

  it("renders nothing while the grants load or outside the provider, never a dead button", () => {
    ctx.value = { loading: true, requestAccess: vi.fn() };
    const { container, rerender } = render(<RequestAccessButton resource="rules" action="edit" />);
    expect(container).toBeEmptyDOMElement();
    ctx.value = null;
    rerender(<RequestAccessButton resource="rules" action="edit" />);
    expect(container).toBeEmptyDOMElement();
  });
});

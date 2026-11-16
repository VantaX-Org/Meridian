import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { NotifyFlow } from "../NotifyFlow";

vi.mock("../../admin/notify", () => ({
  NotificationsSectionNative: () => <div data-testid="notify-native" />,
}));

describe("notify flow sheet", () => {
  it("draws the native notifications section and closes", () => {
    const close = vi.fn();
    renderWithQuery(<NotifyFlow ctx={{ close } as never} />);
    expect(screen.getByTestId("notify-native")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(close).toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { LicenceFlow } from "../LicenceFlow";

vi.mock("../../admin/tenant", () => ({
  LicenceSectionNative: () => <div data-testid="licence-native" />,
}));

describe("licence flow sheet", () => {
  it("draws the native licence section and closes", () => {
    const close = vi.fn();
    renderWithQuery(<LicenceFlow ctx={{ close } as never} />);
    expect(screen.getByTestId("licence-native")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(close).toHaveBeenCalled();
  });
});

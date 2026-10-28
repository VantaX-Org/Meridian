import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn() }) }));

import NotificationsRedirect from "../page";

describe("admin notifications page", () => {
  it("sends client navigation on to Alerts", () => {
    const { container } = render(<NotificationsRedirect />);
    expect(replace).toHaveBeenCalledWith("/admin/alerts");
    expect(container).toBeEmptyDOMElement();
  });
});

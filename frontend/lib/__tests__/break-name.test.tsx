import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BREAK_AT_SEPARATORS, breakAtUnderscores } from "../break-name";

describe("breakAtUnderscores", () => {
  it("offers a line break after each underscore only, keeping every word whole", () => {
    const { container } = render(<span className={BREAK_AT_SEPARATORS}>{breakAtUnderscores("sd_customer_master_1k")}</span>);
    const span = container.firstElementChild!;
    expect(span).toHaveTextContent(/^sd_customer_master_1k$/);
    expect(span.querySelectorAll("wbr")).toHaveLength(3);
    // Each break opportunity follows an underscore: the text before every <wbr> ends in "_".
    for (const w of span.querySelectorAll("wbr")) expect(w.previousSibling?.textContent).toMatch(/_$/);
    // The words are never split by the browser: no overflow-wrap:anywhere or break-all.
    expect(span.className).toContain("[overflow-wrap:normal]");
    expect(span.className).toContain("[word-break:normal]");
  });

  it("leaves a name without underscores as it is", () => {
    const { container } = render(<span>{breakAtUnderscores("ERP-SIM vendors")}</span>);
    expect(container.querySelectorAll("wbr")).toHaveLength(0);
    expect(container).toHaveTextContent("ERP-SIM vendors");
  });
});

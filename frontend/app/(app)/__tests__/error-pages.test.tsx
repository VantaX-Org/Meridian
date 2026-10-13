import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { allowConsoleError } from "@/vitest.console";

const report = vi.fn();
vi.mock("@/lib/client-errors", async (orig) => ({ ...(await orig<typeof import("@/lib/client-errors")>()), reportClientError: (...a: unknown[]) => report(...a) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/objects" }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

import AppError from "../error";
import AppNotFound from "../not-found";
import RootNotFound from "../../not-found";
import GlobalError from "../../global-error";

const error = Object.assign(new Error("kaboom"), { digest: "dg-42" });

describe("error surfaces", () => {
  beforeEach(() => report.mockClear());

  it("app error page shows the reference, retries, links home and reports once", async () => {
    const reset = vi.fn();
    render(<AppError error={error} reset={reset} />);
    expect(screen.getByText("This page hit an error")).toBeInTheDocument();
    expect(screen.getByText("dg-42")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go home" })).toHaveAttribute("href", "/home");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(error, { digest: "dg-42", pathname: "/objects" });
  });

  it("copy details writes digest, message, pathname and time to the clipboard", async () => {
    const user = userEvent.setup();
    render(<AppError error={error} reset={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Copy details" }));
    const copied = JSON.parse(await navigator.clipboard.readText()) as Record<string, string>;
    expect(copied).toMatchObject({ digest: "dg-42", message: "kaboom", pathname: "/objects" });
    expect(copied.time).toBeTruthy();
  });

  it("global error renders its own document copy with the same actions", async () => {
    const reset = vi.fn();
    // <html> cannot nest in the test container, so React logs a nesting warning that is expected here.
    allowConsoleError();
    render(<GlobalError error={error} reset={reset} />);
    expect(screen.getByText("This page hit an error")).toBeInTheDocument();
    expect(screen.getByText("dg-42")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Go home" })).toHaveAttribute("href", "/home");
  });

  it.each([
    ["app", AppNotFound],
    ["root", RootNotFound],
  ])("%s not-found offers home and search", (_n, Page) => {
    render(<Page />);
    expect(screen.getByText("There is nothing at this address")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go home" })).toHaveAttribute("href", "/home");
    expect(screen.getByRole("link", { name: "Search" })).toHaveAttribute("href", "/search");
  });
});

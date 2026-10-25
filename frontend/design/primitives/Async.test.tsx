import { render, screen } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";
import { describe, expect, it, vi } from "vitest";
import { Async, asyncStateOf, type AsyncQuery } from "./Async";

const q = <T,>(over: Partial<AsyncQuery<T>>): AsyncQuery<T> => ({ isLoading: false, isError: false, error: null, data: undefined, ...over });
const http = (status: number) => new AxiosError("x", "ERR", undefined, undefined, { status, statusText: "", data: {}, headers: {}, config: { headers: new AxiosHeaders() } });

describe("asyncStateOf", () => {
  it("reads loading, error, empty and ready from a query", () => {
    expect(asyncStateOf(q({ isLoading: true }))).toBe("loading");
    expect(asyncStateOf(q({ isError: true, error: http(500) }))).toBe("error");
    expect(asyncStateOf(q({ data: [] as number[] }), (d) => d.length === 0)).toBe("empty");
    expect(asyncStateOf(q({ data: [1] }), (d) => d.length === 0)).toBe("ready");
  });
  it("reads a 404 as empty only for list endpoints", () => {
    expect(asyncStateOf(q({ isError: true, error: http(404) }))).toBe("error");
    expect(asyncStateOf(q({ isError: true, error: http(404) }), undefined, true)).toBe("empty");
  });
});

describe("Async", () => {
  it("shows the skeleton while loading", () => {
    const { container } = render(<Async query={q({ isLoading: true })} skeleton={120}>never</Async>);
    expect(container.querySelector("[data-state='loading']")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    expect(screen.queryByText("never")).toBeNull();
  });
  it("shows apiErrorState's title and retries the query", () => {
    const refetch = vi.fn();
    render(<Async query={q({ isError: true, error: http(404), refetch })}>never</Async>);
    expect(screen.getByText("Not found.")).toBeInTheDocument();
    screen.getByRole("button", { name: "Retry" }).click();
    expect(refetch).toHaveBeenCalled();
  });
  it("reads a raw `error` through apiErrorState, so a 403 is not \"Could not reach the server.\"", () => {
    const onRetry = vi.fn();
    render(<Async state="error" error={{ error: http(403), onRetry }}>never</Async>);
    expect(screen.getByText("You do not have access to this.")).toBeInTheDocument();
    expect(screen.queryByText(/could not reach the server/i)).toBeNull();
    screen.getByRole("button", { name: "Retry" }).click();
    expect(onRetry).toHaveBeenCalled();
  });
  it("reads a 500 as a server error and keeps an explicit title over the error's", () => {
    render(<Async state="error" error={{ error: http(500) }}>never</Async>);
    expect(screen.getByText("The server could not complete the request.")).toBeInTheDocument();
    render(<Async state="error" error={{ error: http(500), title: "Rules did not load." }}>never</Async>);
    expect(screen.getByText("Rules did not load.")).toBeInTheDocument();
  });
  it("still takes the old message-only error", () => {
    render(<Async state="error" error={{ message: "Something specific" }}>never</Async>);
    expect(screen.getByText("Could not reach the server.")).toBeInTheDocument();
    expect(screen.getByText("Something specific")).toBeInTheDocument();
  });
  it("shows the empty copy, or the children when there is none", () => {
    render(<Async query={q({ data: [] as number[] })} isEmpty={(d) => d.length === 0} empty={{ title: "No rules yet" }}>never</Async>);
    expect(screen.getByText("No rules yet")).toBeInTheDocument();
    render(<Async state="empty">own empty line</Async>);
    expect(screen.getByText("own empty line")).toBeInTheDocument();
  });
  it("hands the data to a render function when ready", () => {
    render(<Async query={q({ data: { n: 3 } })}>{(d) => <span>{`n=${d.n}`}</span>}</Async>);
    expect(screen.getByText("n=3")).toBeInTheDocument();
  });
});

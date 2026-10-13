import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach } from "vitest";
import { cleanup, configure } from "@testing-library/react";
import { installConsoleErrorFailure } from "./vitest.console";

// findBy and waitFor poll for 1 s by default, which a coverage run on a busy runner can exceed.
configure({ asyncUtilTimeout: 5000 });

const consoleErrors = installConsoleErrorFailure();

beforeEach(consoleErrors.before);
// cleanup first so unmount-time errors are still inside the check.
afterEach(cleanup);
afterEach(consoleErrors.after);

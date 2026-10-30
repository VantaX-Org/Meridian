import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach } from "vitest";
import { cleanup, configure } from "@testing-library/react";
import { installConsoleErrorFailure } from "./vitest.console";
import { registerCatalogue } from "./lib/v2/i18n";
import { de } from "./lib/v2/i18n/de";
import { ja } from "./lib/v2/i18n/ja";

// Tests switch language synchronously (setLang); the browser fetches German and Japanese on demand.
registerCatalogue("de", de);
registerCatalogue("ja", ja);

// findBy and waitFor poll for 1 s by default, which a coverage run on a busy runner can exceed.
configure({ asyncUtilTimeout: 5000 });

const consoleErrors = installConsoleErrorFailure();

beforeEach(consoleErrors.before);
// cleanup first so unmount-time errors are still inside the check.
afterEach(cleanup);
afterEach(consoleErrors.after);

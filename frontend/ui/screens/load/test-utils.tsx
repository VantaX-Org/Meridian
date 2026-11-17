import type { ReactElement } from "react";
import { renderWithQuery } from "@/__tests__/render";
import { AletheiaProvider } from "@/ui/kit";

/** Render a screen inside the query client and the Aletheia provider the app shell supplies. */
export const renderScreen = (ui: ReactElement) => renderWithQuery(<AletheiaProvider>{ui}</AletheiaProvider>);

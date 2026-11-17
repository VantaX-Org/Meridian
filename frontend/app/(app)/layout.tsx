import type { ReactNode } from "react";
import "@/ui/tokens.css";
import "@/ui/kit/kit.css";
import "@/ui/auth/auth.css";
import { plexClass } from "../fonts";
import { Frame } from "./Frame";

export default function UiLayout({ children }: { children: ReactNode }) {
  return <div className={plexClass}><Frame>{children}</Frame></div>;
}

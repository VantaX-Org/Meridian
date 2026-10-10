"use client";

import { Moon, Sun } from "lucide-react";
import { IconButton } from "@/design";
import { useAuroraPrefs } from "@/hooks/use-theme";

/** Light/dark switch for the app shell topbar. Choice is stored per browser by useAuroraPrefs. */
export function ThemeToggle() {
  const { theme, setTheme } = useAuroraPrefs();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <IconButton aria-label={`Switch to ${next} theme`} onClick={() => setTheme(next)}>
      {theme === "dark" ? <Sun size={16} aria-hidden /> : <Moon size={16} aria-hidden />}
    </IconButton>
  );
}

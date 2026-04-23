/**
 * Aurora components barrel — single import site for every Aurora surface.
 *
 * `import { Button, Text, Stack } from "@/components/aurora";`
 *
 * Tokens live in `@/lib/aurora` and are read by primitives here through CSS
 * variables. Data primitives (Table, Chart, ProcessGraph, Stat, KpiRail),
 * shell (AppShell, WorkspaceSwitcher, CommandPalette, Drawer, Tabs), and
 * signature moments layer on top of this barrel in WS3 / WS4 / WS5.
 */

export * from "./primitives";
export * from "./data";
export * from "./shell";
export * from "./moments";

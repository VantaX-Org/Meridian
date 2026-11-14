"use client";

import type { ComponentType } from "react";
import { useUiNext } from "../useUiNext";

/** The (v2) route keeps its address. With the new interface on it shows the new screen, otherwise the old one. */
export function NextSwap({ next: Next, old: Old }: { next: ComponentType; old: ComponentType }) {
  return useUiNext() ? <Next /> : <Old />;
}

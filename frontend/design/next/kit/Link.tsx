"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { useV2Href } from "@/lib/v2/hooks";

/** A link that keeps `?fixture=1` when the page is in fixture mode. */
export function NxLink({ href, ...rest }: Omit<ComponentProps<typeof Link>, "href"> & { href: string }) {
  const v2Href = useV2Href();
  return <Link href={v2Href(href)} {...rest} />;
}

import { ImageResponse } from "next/og";
import { appleIcon } from "@/design/brand/images";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(appleIcon(), size);
}

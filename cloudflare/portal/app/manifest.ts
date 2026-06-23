import type { MetadataRoute } from "next";

// Next 15 metadata route → served at /manifest.webmanifest and auto-linked in
// every page <head>. Scoped to /admin so the installed app is the admin portal,
// not the public marketing/sign-in pages. Aurora dark tokens for chrome colours.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Meridian HQ",
    short_name: "Meridian HQ",
    description: "Meridian licence, billing and tenant administration",
    start_url: "/admin/dashboard",
    scope: "/admin",
    display: "standalone",
    background_color: "#0A0E1A",
    theme_color: "#0057D2",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}

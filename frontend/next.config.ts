import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",

  async rewrites() {
    // INTERNAL_API_URL is a server-side-only env var.
    // In Docker: resolves to http://api:8000 via Docker DNS.
    // In local dev: defaults to http://localhost:8000.
    const apiUrl = process.env.INTERNAL_API_URL || "http://localhost:8000";

    return [
      {
        // Proxy all /api/* requests to the FastAPI backend
        source: "/api/:path*",
        destination: `${apiUrl}/api/:path*`,
      },
      {
        // Proxy the health endpoint (useful for monitoring)
        source: "/health",
        destination: `${apiUrl}/health`,
      },
    ];
  },
};

export default nextConfig;

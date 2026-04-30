import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",

  async rewrites() {
    // INTERNAL_API_URL is a server-side-only env var.
    // In Docker: resolves to http://api:8000 via Docker DNS.
    // On host dev (npm run dev): set INTERNAL_API_URL=http://localhost:8000.
    // Default to Docker service DNS so production image builds don't accidentally
    // bake localhost (which would point to the frontend container itself).
    const apiUrl = process.env.INTERNAL_API_URL || "http://api:8000";

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

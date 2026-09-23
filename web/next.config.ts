import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const API_ORIGIN = process.env.ROCKET_API_ORIGIN || "http://localhost:8080";

/**
 * Builds a static export for the Go API to serve, and in development proxies
 * `/api` to the API since `next dev` does not serve it.
 */
export default function nextConfig(phase: string): NextConfig {
  if (phase === PHASE_DEVELOPMENT_SERVER)
    return {
      rewrites: async () => [
        { source: "/api/:path*", destination: `${API_ORIGIN}/api/:path*` },
      ],
    };
  return { output: "export", images: { unoptimized: true } };
}

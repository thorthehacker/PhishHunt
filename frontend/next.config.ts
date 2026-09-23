import type { NextConfig } from "next";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${API_URL}/:path*`,
      },
      {
        source: "/captures/submit",
        destination: `${API_URL}/captures/submit`,
      },
      {
        source: "/landing-pages/clone-assets/:path*",
        destination: `${API_URL}/landing-pages/clone-assets/:path*`,
      },
    ];
  },
};

export default nextConfig;

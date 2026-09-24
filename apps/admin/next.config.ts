import type { NextConfig } from "next";

const proxyTarget = (
  process.env.ADMIN_API_PROXY_TARGET ??
  "http://localhost:4000/api"
).replace(/\/$/, "");

const nextConfig: NextConfig = {
  transpilePackages: ["@propops/ui"],
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: proxyTarget + "/:path*"
      }
    ];
  }
};

export default nextConfig;

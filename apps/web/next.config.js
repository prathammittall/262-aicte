const BACKEND_URL =
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "https://aicte.duckdns.org";

/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${BACKEND_URL.replace(/\/+$/, "")}/api/:path*`,
      },
      {
        source: "/health",
        destination: `${BACKEND_URL.replace(/\/+$/, "")}/health`,
      },
    ];
  },
};

export default nextConfig;


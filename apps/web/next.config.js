const rawBackendUrl =
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "https://aicte.duckdns.org";

const BACKEND_URL =
  rawBackendUrl.startsWith("http://") && rawBackendUrl.includes("aicte.duckdns.org")
    ? rawBackendUrl.replace(/^http:\/\//, "https://")
    : rawBackendUrl;

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


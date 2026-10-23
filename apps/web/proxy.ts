import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Target deployed backend URL
const rawBackendUrl =
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "https://aicte.duckdns.org";

const BACKEND_URL =
  rawBackendUrl.startsWith("http://") && rawBackendUrl.includes("aicte.duckdns.org")
    ? rawBackendUrl.replace(/^http:\/\//, "https://")
    : rawBackendUrl;

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Normalize base URL without trailing slash
  const targetBase = BACKEND_URL.replace(/\/+$/, "");
  const targetUrl = new URL(`${pathname}${search}`, targetBase);

  // Forward incoming headers to backend
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-forwarded-host", request.headers.get("host") || "");
  requestHeaders.set("x-forwarded-proto", request.nextUrl.protocol.replace(":", ""));

  return NextResponse.rewrite(targetUrl, {
    request: {
      headers: requestHeaders,
    },
  });
}

// Export as default and middleware for complete compatibility across Next.js versions
export default proxy;
export { proxy as middleware };

export const config = {
  matcher: ["/api/:path*", "/health"],
};

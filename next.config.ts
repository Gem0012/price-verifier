import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Apply the security headers to every route.
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
  // FOLLOW-UP: add a Content-Security-Policy. Not done here because it needs
  // careful testing first: Next.js injects inline bootstrap scripts (needs
  // 'unsafe-inline' or nonce-based 'script-src') and the app runs matching in
  // a web worker (needs 'worker-src'/'child-src' blob/frame directives), so a
  // naive CSP would break the app.
};

export default nextConfig;

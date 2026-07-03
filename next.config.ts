import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root to this project. Without this, a stray lockfile in a
  // parent directory (e.g. ~/Coding/package-lock.json) makes Next/Turbopack infer
  // the wrong root and mis-resolve modules. See docs → "inferred workspace root".
  turbopack: {
    root: __dirname,
  },

  // Production security headers (see docs/production/security-headers.md).
  // CSP is intentionally omitted for now — add in report-only mode first so it
  // doesn't break Supabase / signed-URL requests.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;

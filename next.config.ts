import type { NextConfig } from "next";
// Relative, not `@/`: the `paths` alias is a tsconfig/bundler concern and is
// not resolved by the loader that evaluates this config file.
import { securityHeaders } from "./src/lib/security/headers";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders(),
      },
      {
        // Verified against node_modules/next/dist/docs "Header Overriding
        // Behavior": when two blocks match the same path and set the same key,
        // the last one wins — so this block stays last and its Cache-Control
        // survives the site-wide block above.
        //
        // The worker script itself must never be cached, or a browser can keep
        // serving an old worker and the update prompt never appears.
        // `Service-Worker-Allowed: /` lets it control the whole origin.
        source: "/sw.js",
        headers: [
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;

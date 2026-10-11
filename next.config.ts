import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  serverExternalPackages: ["sarvamai", "ffmpeg-static"],
  experimental: {
    serverActions: {
      bodySizeLimit: "200mb",
    },
    proxyClientMaxBodySize: "200mb",
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

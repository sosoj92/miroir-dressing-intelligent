import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // `next dev` n'écrit pas de bloc dans AGENTS.md (fichier écrit à la main, à ne pas modifier).
  agentRules: false,
  cacheComponents: true,
  partialPrefetching: true,
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

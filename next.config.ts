import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `next dev` otherwise writes an AGENTS.md (instructions for AI coding agents) into the repo.
  agentRules: false,
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

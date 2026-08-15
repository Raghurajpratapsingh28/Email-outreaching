import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // web/ sits inside Email/ but is its own git repo, which confuses
  // Turbopack's automatic root/lockfile detection — pin it explicitly.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;

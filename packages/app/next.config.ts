import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  turbopack: {
    root: path.resolve(process.cwd(), "../.."),
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@noble/hashes": path.resolve(process.cwd(), "../../node_modules/@noble/hashes"),
      "@react-native-async-storage/async-storage": false,
    };

    return config;
  },
};

export default nextConfig;

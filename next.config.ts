import type { NextConfig } from "next";
import { OPTIMIZED_IMAGE_HOSTS, supabaseImageHost } from "./src/lib/image-hosts";

const supabaseHost = supabaseImageHost();

const nextConfig: NextConfig = {
  serverExternalPackages: ["sharp"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  images: {
    remotePatterns: [
      // Seed/demo product images, Google avatars, Supabase Storage (see src/lib/image-hosts.ts)
      ...OPTIMIZED_IMAGE_HOSTS.map((hostname) => ({ protocol: "https" as const, hostname })),
      // Whatever NEXT_PUBLIC_SUPABASE_URL points at (covers self-hosted Supabase on a custom domain)
      ...(supabaseHost && supabaseHost.protocol === "https" ? [{ protocol: "https" as const, hostname: supabaseHost.hostname, port: supabaseHost.port }] : []),
    ],
  },
  experimental: {
    agentUpgrade: "security",
    serverActions: {
      // product image uploads go through a Server Action (bucket limit is 5 MB)
      bodySizeLimit: "6mb",
    },
  },
};

export default nextConfig;

import type { NextConfig } from "next";

// next.config.ts is evaluated at BUILD time, so NEXT_PUBLIC_SUPABASE_URL must
// be present in the build environment. Falling back silently to localhost in
// production would make every question image 400 with a confusing error, so
// fail loudly instead.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!supabaseUrl && process.env.NODE_ENV === "production") {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL must be set at build time for question images to load"
  );
}
const supabase = new URL(supabaseUrl ?? "http://127.0.0.1:54321");
const isLocalSupabase = ["127.0.0.1", "localhost", "::1"].includes(
  supabase.hostname
);

const nextConfig: NextConfig = {
  images: {
    // Next 16 refuses to optimize images that resolve to a private IP — an
    // SSRF guard. Local Supabase serves Storage from 127.0.0.1:54321, so the
    // guard has to be lifted for local development only. A hosted project is
    // a public https host and keeps the protection.
    dangerouslyAllowLocalIP: isLocalSupabase,

    // Scoped to exact hosts and path prefixes rather than wildcards, so a
    // stray remote URL elsewhere can't quietly become an optimized image.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        pathname: "/photo-**",
      },
      {
        protocol: supabase.protocol.replace(":", "") as "http" | "https",
        hostname: supabase.hostname,
        port: supabase.port,
        pathname: "/storage/v1/object/public/question-images/**",
      },
    ],
  },
};

export default nextConfig;

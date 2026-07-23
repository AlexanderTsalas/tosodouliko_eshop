/** @type {import('next').NextConfig} */

/**
 * Image hostname allowlist — driven by env so each deployment
 * configures its own. Hardcoding "**.supabase.co" only worked when the
 * project was Supabase-only; with the StorageProvider abstraction
 * landed (src/lib/storage), the same codebase can deploy against
 * Cloudflare R2, AWS S3, MinIO on a VPS, etc.
 *
 * Env var:
 *
 *     IMAGE_HOSTNAMES — comma-separated list of hostname patterns
 *
 *   Examples per deployment:
 *
 *     Supabase Cloud:
 *       IMAGE_HOSTNAMES=**.supabase.co
 *
 *     Cloudflare R2 with custom domain:
 *       IMAGE_HOSTNAMES=cdn.yourshop.gr,**.r2.cloudflarestorage.com
 *
 *     MinIO on VPS:
 *       IMAGE_HOSTNAMES=storage.yourshop.gr
 *
 *     Multi-deployment (dev = Supabase, prod = R2 + custom domain):
 *       IMAGE_HOSTNAMES=**.supabase.co,cdn.yourshop.gr
 *
 * The Supabase pattern is included by default for backwards-compat
 * with deployments that haven't set the env var yet.
 */
const allowedHostnames = (
  process.env.IMAGE_HOSTNAMES ?? "**.supabase.co"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: allowedHostnames.map((hostname) => ({
      protocol: "https",
      hostname,
    })),
    // AVIF + WebP format negotiation. The browser sends Accept; Next
    // picks AVIF if supported, falls back to WebP, then JPEG.
    formats: ["image/avif", "image/webp"],
  },
};

export default nextConfig;

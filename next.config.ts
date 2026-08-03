import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js blocks dev-server asset/HMR requests from origins other than
  // localhost unless explicitly allowed. Add your LAN/Tailscale IP here if
  // it changes (shown as "Network:" in the `next dev` terminal output).
  allowedDevOrigins: ["100.99.229.82", "106.192.46.56"],

  async headers() {
    // Deliberately NOT setting Content-Security-Policy here: this app's
    // entire UI is built on inline `style={{}}` throughout page.tsx and the
    // auth pages — a CSP strict enough to matter would need
    // `style-src 'unsafe-inline'` anyway (defeating most of its point) or a
    // full rewrite to CSS modules/classes first. These headers are the ones
    // that are safe to add without touching the frontend architecture.
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js blocks dev-server asset/HMR requests from origins other than
  // localhost unless explicitly allowed. Add your LAN/Tailscale IP here if
  // it changes (shown as "Network:" in the `next dev` terminal output).
  allowedDevOrigins: ["100.99.229.82", "106.192.46.56"],
};

export default nextConfig;

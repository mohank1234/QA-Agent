import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js blocks dev-server asset/HMR requests from origins other than
  // localhost unless explicitly allowed. Add your LAN/Tailscale IP here if
  // it changes (shown as "Network:" in the `next dev` terminal output).
  allowedDevOrigins: ["100.99.229.82", "106.192.46.56"],

  // @anthropic-ai/claude-agent-sdk ships its actual CLI as a
  // platform-specific native binary via optionalDependencies (e.g.
  // @anthropic-ai/claude-agent-sdk-linux-x64) and resolves it at runtime in
  // a way Next's static import-graph bundling/file-tracing can't follow —
  // on Vercel this meant the binary was installed during the build but
  // never copied into the deployed serverless function, failing every
  // /api/chat call with "Native CLI binary for linux-x64 not found".
  // Marking it external makes Next use a plain Node `require()` for it
  // instead of bundling (needed), but doesn't by itself make Next's output
  // file tracing *copy* the dynamically-resolved binary package into the
  // deployment (separate problem, fixed below).
  // pdf-parse (via pdfjs-dist's "legacy" Node build) sets up its text
  // extraction by dynamically importing its own pdf.worker.mjs as a "fake
  // worker" running in-process. Bundled by Turbopack/webpack, that dynamic
  // import resolves against the bundled chunk graph instead of the real
  // package directory, and pdf.worker.mjs never gets copied into it —
  // every PDF upload's preview/analysis then fails with "Setting up fake
  // worker failed: Cannot find module '.../pdf.worker.mjs'". Marking both
  // packages external makes Next `require()`/`import()` them directly from
  // node_modules at runtime, where the worker file actually sits next to
  // the rest of the package. Same root cause as the claude-agent-sdk entry
  // above: a dependency that resolves part of itself dynamically at
  // runtime in a way static bundling can't follow.
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk", "pdf-parse", "pdfjs-dist"],

  // The actual fix for the "never copied into the deployment" half: the SDK
  // picks its native binary package (…-linux-x64, …-linux-arm64, etc.) based
  // on process.platform/process.arch at runtime, which @vercel/nft's static
  // trace can't follow, so it silently omits it. Explicitly including all
  // Linux variants covers every architecture/libc Vercel might run
  // functions on, not just the x64 glibc one seen in testing.
  outputFileTracingIncludes: {
    "/api/chat": ["node_modules/@anthropic-ai/claude-agent-sdk-linux-*/**/*"],
  },

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

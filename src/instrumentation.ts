export async function register() {
  // Only the Node.js runtime touches SQLite/fs/Sentry-node — skip on the
  // Edge runtime, which this app doesn't use for anything here anyway.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { config } = await import("./lib/config");

    if (config.sentry) {
      const Sentry = await import("@sentry/node");
      Sentry.init({
        dsn: config.sentry.dsn,
        environment: config.isProduction ? "production" : "development",
        tracesSampleRate: 0.1,
      });
    }

    const { startGuestProjectCleanupSweep } = await import("./lib/projectCleanup");
    startGuestProjectCleanupSweep();
  }
}

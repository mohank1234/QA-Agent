import { PostHog } from "posthog-node";
import { config } from "./config";

let client: PostHog | null = null;

function getClient(): PostHog | null {
  if (!config.posthog) return null;
  if (!client) {
    // flushAt: 1 — send each event immediately rather than posthog-node's
    // default batching. This app is headed for Vercel (serverless function
    // invocations can suspend between requests), where a buffered-but-not-
    // yet-flushed event would just be silently lost. Slightly more network
    // overhead per event, negligible at this app's scale.
    client = new PostHog(config.posthog.apiKey, { host: config.posthog.host, flushAt: 1, flushInterval: 0 });
  }
  return client;
}

export function trackEvent(distinctId: string, event: string, properties?: Record<string, unknown>): void {
  getClient()?.capture({ distinctId, event, properties });
}

export function isAnalyticsConfigured(): boolean {
  return config.posthog !== null;
}

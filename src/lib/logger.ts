import pino from "pino";
import * as Sentry from "@sentry/node";
import { config } from "./config";

// Server-only — never import this from a "use client" component (Pino uses
// Node's fs/process bindings, doesn't run in the browser).

const ERROR_LEVEL = 50;
const FATAL_LEVEL = 60;

export const logger = pino({
  level: config.logLevel,
  // Plain JSON in production (what a log aggregator/Sentry-adjacent tooling
  // wants); pretty-printed only in dev, where a human is actually reading
  // the terminal.
  transport: config.isProduction
    ? undefined
    : { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" } },
  hooks: {
    // Every logger.error(...)/logger.fatal(...) call site in the app also
    // reports to Sentry, with zero extra call sites to maintain — the
    // alternative (manually pairing captureException with each logger.error
    // call) would drift out of sync the moment someone adds a new one.
    // No-op when SENTRY_DSN isn't set (Sentry.captureException is a safe
    // no-op with no client initialized) or the log is below error level.
    logMethod(args, method, level) {
      if (config.sentry && (level === ERROR_LEVEL || level === FATAL_LEVEL)) {
        const [first, second] = args;
        const mergingObject =
          typeof first === "object" && first !== null ? (first as Record<string, unknown>) : undefined;
        const err = mergingObject?.err;
        const message = typeof first === "string" ? first : typeof second === "string" ? second : undefined;

        if (err instanceof Error) {
          Sentry.captureException(err, { extra: mergingObject, ...(message ? { tags: { pinoMessage: message } } : {}) });
        } else if (message) {
          Sentry.captureMessage(message, { level: "error", extra: mergingObject });
        }
      }
      method.apply(this, args);
    },
  },
});

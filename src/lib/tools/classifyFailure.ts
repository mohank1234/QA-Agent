// Why a failed test is not just "failed".
//
// A run that goes red can mean three completely different things, and they lead
// to opposite actions:
//
//   ASSERTION_FAIL — the element was found, the app did something other than
//                    what the requirement says. A real finding.
//   APP_ERROR      — the app 500'd, threw an uncaught exception, or crashed the
//                    page. Also a real finding, usually a more serious one.
//   SCRIPT_ERROR   — our own locator was wrong, our syntax was broken, or we
//                    navigated somewhere we didn't mean to. Nothing is wrong
//                    with the application; the test is wrong.
//
// Collapsing these into "failed" is what lets a bad selector get written up as
// a defect — a false bug report costs a developer's afternoon and quietly
// destroys trust in the whole suite. So the classification is persisted with
// the execution, and only the first two may ever become a bug report.
//
// This module is deliberately pure: no Playwright import, no database, no file
// system. It takes signals and returns a verdict, which is what makes it
// testable and what keeps the rule enforceable rather than aspirational.

export type FailureClass = "PASS" | "SCRIPT_ERROR" | "ASSERTION_FAIL" | "APP_ERROR";

/**
 * Structured signals captured by the harness while the test ran. Every field is
 * optional because they come from a child process that may have been killed
 * mid-run — a partial signal set is normal and must still classify.
 */
export type RunDiagnostics = {
  /**
   * How the thrown error was produced, tagged at throw time rather than
   * recovered from its message afterwards. This is the highest-value signal
   * here: it is the difference between "the app is wrong" and "we are wrong",
   * and it is knowable exactly where the throw happens.
   */
  failureKind?: "assertion" | "playwright" | "other";
  /** err.name. Playwright uses "TimeoutError" for locator and navigation waits. */
  errorName?: string;
  /** HTTP status of the main document navigation, when one happened. */
  mainStatus?: number;
  /** Responses with status >= 500 seen during the run. */
  serverErrors?: { url: string; status: number; sameOrigin: boolean }[];
  /** Uncaught exceptions thrown by the page's own JavaScript. */
  pageErrors?: string[];
  /** The page process itself crashed. */
  crashed?: boolean;
};

export type Classification = {
  classification: FailureClass;
  /** Human-readable justification — shown in the UI and given to the agent. */
  reason: string;
};

/**
 * Message patterns that identify a broken script when no structured signal is
 * available. Used ONLY as a fallback: a tagged `failureKind` always wins, since
 * a message can be produced by anything and a tag is produced at the throw.
 */
const SCRIPT_ERROR_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /strict mode violation/i, reason: "the locator matched more than one element" },
  { pattern: /waiting for (locator|selector)/i, reason: "a locator never matched an element" },
  { pattern: /locator\.\w+:/i, reason: "a locator operation failed" },
  { pattern: /no element matching/i, reason: "a locator never matched an element" },
  { pattern: /net::ERR_NAME_NOT_RESOLVED/i, reason: "the host in the URL does not resolve" },
  { pattern: /net::ERR_(CONNECTION_REFUSED|ABORTED)/i, reason: "the URL could not be reached" },
  {
    pattern: /(SyntaxError|ReferenceError|TypeError):/,
    reason: "the script itself has a JavaScript error",
  },
  { pattern: /is not (a function|defined)/i, reason: "the script called something that doesn't exist" },
];

function summarizeServerErrors(errors: { url: string; status: number }[]): string {
  const first = errors[0];
  const more = errors.length > 1 ? ` (and ${errors.length - 1} more)` : "";
  return `${first.status} from ${first.url}${more}`;
}

/**
 * Decides what a completed run actually means.
 *
 * Ordering is the substance of this function, not an implementation detail:
 *
 * - Unambiguous application failures (crash, a 5xx on the document itself, an
 *   uncaught exception in page code) come first, because when any of those
 *   happen the assertion never got a fair chance to run.
 * - A tagged assertion failure comes next — the app was reachable and did
 *   something other than what was expected.
 * - Everything else is SCRIPT_ERROR, and so is anything unrecognised. That
 *   default is deliberate and is the safety property of this whole module:
 *   SCRIPT_ERROR can never be auto-drafted as a defect, so an outcome we can't
 *   confidently explain fails toward "our script is suspect" rather than toward
 *   accusing the application. Guessing wrong in that direction costs a retry;
 *   guessing wrong in the other direction costs a developer's afternoon.
 */
export function classifyOutcome(input: {
  passed: boolean;
  timedOut: boolean;
  error?: string;
  diagnostics?: RunDiagnostics;
}): Classification {
  if (input.passed) {
    return { classification: "PASS", reason: "All assertions passed." };
  }

  const d = input.diagnostics ?? {};
  const message = input.error ?? "";

  if (d.crashed) {
    return {
      classification: "APP_ERROR",
      reason: "The page crashed during the run.",
    };
  }

  if (typeof d.mainStatus === "number" && d.mainStatus >= 500) {
    return {
      classification: "APP_ERROR",
      reason: `The page under test returned HTTP ${d.mainStatus}.`,
    };
  }

  if (d.pageErrors && d.pageErrors.length > 0) {
    return {
      classification: "APP_ERROR",
      reason: `The application threw an uncaught exception: ${d.pageErrors[0]}`,
    };
  }

  if (d.failureKind === "assertion") {
    return {
      classification: "ASSERTION_FAIL",
      reason: message
        ? `The application behaved differently than expected: ${message}`
        : "An assertion failed.",
    };
  }

  // Subresource 5xx is weaker evidence than the signals above — the test still
  // ran and still reached its own conclusion — but a failing same-origin API
  // call is the application's fault, not the script's, so it outranks the
  // script-error fallbacks below. Third-party origins are excluded: an
  // analytics beacon returning 503 says nothing about the app under test, and
  // treating it as a defect would be exactly the false positive this classifier
  // exists to prevent.
  const sameOrigin5xx = (d.serverErrors ?? []).filter((e) => e.sameOrigin);
  if (sameOrigin5xx.length > 0) {
    return {
      classification: "APP_ERROR",
      reason: `The application returned a server error: ${summarizeServerErrors(sameOrigin5xx)}`,
    };
  }

  if (d.failureKind === "playwright") {
    const detail =
      d.errorName === "TimeoutError"
        ? "a Playwright operation timed out, which usually means a locator never matched"
        : "a Playwright operation failed";
    return {
      classification: "SCRIPT_ERROR",
      reason: `The test script is at fault — ${detail}. Fix the script rather than raising a defect.`,
    };
  }

  // No structured signal survived (an API test, or a child killed before it
  // could write diagnostics). Fall back to the message.
  for (const { pattern, reason } of SCRIPT_ERROR_PATTERNS) {
    if (pattern.test(message)) {
      return {
        classification: "SCRIPT_ERROR",
        reason: `The test script is at fault — ${reason}. Fix the script rather than raising a defect.`,
      };
    }
  }

  if (d.failureKind === "other" && message) {
    return {
      classification: "ASSERTION_FAIL",
      reason: `The test failed with: ${message}`,
    };
  }

  if (input.timedOut) {
    return {
      classification: "SCRIPT_ERROR",
      reason:
        "The run hit its time limit without completing. Treated as a script problem — a test that cannot finish has not observed anything about the application.",
    };
  }

  return {
    classification: "SCRIPT_ERROR",
    reason: message
      ? `Could not confidently attribute this failure (${message}), so it is treated as a script problem rather than a defect.`
      : "Could not confidently attribute this failure, so it is treated as a script problem rather than a defect.",
  };
}

/**
 * The gate the whole phase exists for. A SCRIPT_ERROR describes a broken test,
 * not broken software, and must never reach the defect tracker.
 */
export function mayBecomeDefect(classification: FailureClass): boolean {
  return classification === "ASSERTION_FAIL" || classification === "APP_ERROR";
}

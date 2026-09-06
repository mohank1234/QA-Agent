// Deterministic word-error-rate scoring — no LLM call, matching the rest of
// this app's tools (all 35 are pure I/O/computation; reasoning happens only
// in the outer agent turn). This is what turns "some text appeared" into a
// real, citable accuracy number for same-language transcript checks.

export type WerResult = {
  wer: number;
  substitutions: number;
  deletions: number;
  insertions: number;
  expectedWordCount: number;
  actualWordCount: number;
};

function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[.,!?;:"'()]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Classic word-level Levenshtein distance (the standard ASR "Word Error
 * Rate" definition: substitutions + deletions + insertions, divided by the
 * expected word count). Punctuation and case are ignored — this measures
 * whether the right words came out, not formatting.
 */
export function wordErrorRate(expected: string, actual: string): WerResult {
  const ref = normalizeWords(expected);
  const hyp = normalizeWords(actual);
  const n = ref.length;
  const m = hyp.length;

  // dp[i][j] = edit distance between ref[0..i) and hyp[0..j)
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 0; i <= n; i++) dp[i][0] = i;
  for (let j = 0; j <= m; j++) dp[0][j] = j;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (ref[i - 1] === hyp[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to split the total distance into substitutions/deletions/
  // insertions individually, not just the combined edit count.
  let i = n;
  let j = m;
  let substitutions = 0;
  let deletions = 0;
  let insertions = 0;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && ref[i - 1] === hyp[j - 1]) {
      i--;
      j--;
      continue;
    }
    if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) {
      substitutions++;
      i--;
      j--;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      deletions++;
      i--;
    } else {
      insertions++;
      j--;
    }
  }

  const distance = dp[n][m];
  // Empty expected text has no meaningful error rate — treat as 0 unless
  // the actual text is also non-empty (pure insertion against nothing).
  const wer = n === 0 ? (m === 0 ? 0 : 1) : distance / n;

  return {
    wer: Number(wer.toFixed(4)),
    substitutions,
    deletions,
    insertions,
    expectedWordCount: n,
    actualWordCount: m,
  };
}

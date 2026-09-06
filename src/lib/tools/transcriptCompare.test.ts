import { describe, it, expect } from "vitest";
import { wordErrorRate } from "./transcriptCompare";

describe("wordErrorRate", () => {
  it("scores an exact match as zero error", () => {
    const r = wordErrorRate("this is a test of transcription", "this is a test of transcription");
    expect(r.wer).toBe(0);
    expect(r.substitutions).toBe(0);
    expect(r.deletions).toBe(0);
    expect(r.insertions).toBe(0);
  });

  it("ignores case and punctuation differences", () => {
    const r = wordErrorRate("Hello, world!", "hello world");
    expect(r.wer).toBe(0);
  });

  it("counts a substitution", () => {
    const r = wordErrorRate("the quick brown fox", "the quick brown dog");
    expect(r.substitutions).toBe(1);
    expect(r.deletions).toBe(0);
    expect(r.insertions).toBe(0);
    expect(r.wer).toBe(0.25);
  });

  it("counts a deletion (word dropped from the transcript)", () => {
    const r = wordErrorRate("the quick brown fox", "the quick fox");
    expect(r.deletions).toBe(1);
    expect(r.wer).toBe(0.25);
  });

  it("counts an insertion (extra word the speaker never said)", () => {
    const r = wordErrorRate("the quick fox", "the quick brown fox");
    expect(r.insertions).toBe(1);
    expect(r.wer).toBeCloseTo(1 / 3, 4);
  });

  it("scores completely wrong output as high error", () => {
    const r = wordErrorRate("hello there friend", "goodbye now stranger");
    expect(r.wer).toBe(1);
  });

  it("handles an empty expected string without dividing by zero", () => {
    expect(wordErrorRate("", "").wer).toBe(0);
    expect(wordErrorRate("", "unexpected words").wer).toBe(1);
  });
});

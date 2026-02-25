import { describe, it, expect } from "vitest";
import { GitDiffStatSchema } from "../src/schemas/git.js";

describe("GitDiffStatSchema", () => {
  it("validates a valid diff stat", () => {
    const stat = {
      files: [
        { path: "src/foo.ts", insertions: 5, deletions: 2, binary: false, untracked: false, staged: false },
        { path: "image.png", insertions: 0, deletions: 0, binary: true, untracked: false, staged: true },
      ],
      totalInsertions: 5,
      totalDeletions: 2,
    };
    expect(GitDiffStatSchema.parse(stat)).toEqual(stat);
  });

  it("rejects negative insertion count", () => {
    const stat = {
      files: [{ path: "a.ts", insertions: -1, deletions: 0, binary: false, untracked: false, staged: false }],
      totalInsertions: -1,
      totalDeletions: 0,
    };
    expect(() => GitDiffStatSchema.parse(stat)).toThrow();
  });
});

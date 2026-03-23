---
title: 'Merge conflict resolution silently dropped feature commits'
category: integration-issues
date: 2026-03-18
tags: [git, merge-conflict, regression, send-flow]
severity: high
modules: [src/pages/Send.tsx, src/pages/Send.test.tsx]
---

## Problem

After merging PR #34 (VSS client foundation), the send flow regressed from recipient-first back to amount-first. The recipient-first restructure (commits `814b72e`, `3d08abc`) was silently lost — no errors, no test failures, just wrong behavior.

## Root Cause

During merge conflict resolution for PR #34, `src/pages/Send.tsx` and `src/pages/Send.test.tsx` had conflicts between the VSS branch and main. The resolution used `git checkout origin/main -- src/pages/Send.tsx src/pages/Send.test.tsx` to accept main's version wholesale. However, the VSS branch contained commits from a prior feature (recipient-first send flow) that had not yet landed on main. Accepting main's version silently discarded those feature commits.

The key issue: **the VSS branch was created from a working tree that already had uncommitted/unpushed changes to Send.tsx**. When the merge conflict arose, the resolution treated those changes as "not ours" and dropped them.

## Solution

Restored the recipient-first files from the lost commit using `git show`:

```bash
git show 3d08abc:src/pages/Send.tsx > src/pages/Send.tsx
git show 3d08abc:src/pages/Send.test.tsx > src/pages/Send.test.tsx
```

Verified tests pass (214/214), committed directly to main.

## Prevention

1. **Never resolve merge conflicts by accepting one side wholesale** (`git checkout --theirs` or `git checkout origin/main -- file`) without verifying what's being discarded. Always inspect the diff of both sides first.

2. **Feature branches should be clean**: Don't create a new feature branch from a working tree that has unrelated uncommitted changes. Stash or commit them first. The VSS branch inadvertently carried Send.tsx changes that weren't part of the VSS feature.

3. **After merge conflict resolution, diff the resolution against both parents** to confirm no unintended deletions:

   ```bash
   git diff HEAD~1 -- src/pages/  # What changed in the merge commit?
   ```

4. **Run the app and verify core flows after any merge**, not just tests. The tests for the old amount-first flow still passed — they were also overwritten with the old version, so the regression was invisible to CI.

## Key Insight

Test suites can mask regressions when both the implementation AND the tests are reverted together. If `Send.tsx` regresses to amount-first and `Send.test.tsx` also regresses to amount-first tests, all tests pass. The regression is only visible through manual testing or by noticing the test file itself changed unexpectedly.

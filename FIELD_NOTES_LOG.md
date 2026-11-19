# Field notes log

Running log of real problems hit while building and deploying the Mama Tolu's Kitchen Chord teammate. Only problems that actually happened go here, logged as they happen. Secrets are never pasted; request IDs are.

Entry format:

```
## N. <short title> (YYYY-MM-DD, step)
- What happened: exact error message / HTTP status / request ID
- How we found the cause:
- Fix:
- Suggestion for Chord:
```

<!-- entries below -->

## 1. `node --test test/` fails on Windows (2026-11-20, Task 2, local tooling)
- What happened: `npm test` printed `# Error: Cannot find module 'C:\Users\fagbe\Documents\tsg-chord-agent\test'` with `code: 'ERR_TEST_FAILURE'` and reported `# pass 0 / # fail 1` before any test file had been written to run.
- How we found the cause: the error names the folder itself as a module, so Node 22 was treating the `test/` argument as a file path, not a directory to search.
- Fix: changed the script to a glob, `node --test "test/**/*.test.js"`. The run then failed for the expected reason (`lib/menu.js` missing).
- Suggestion for Chord: none; this is local Node tooling, not Chord. Kept for completeness and unlikely to make the final field notes.

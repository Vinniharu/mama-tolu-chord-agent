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

## 2. Paystack `401 Invalid key` while our health check said "test" (2026-11-20, Task 6, first real Paystack call)
- What happened: the local smoke test passed health, auth, initialize and tools/list, then failed on `create_payment_link` with `code=PAYSTACK_ERROR`. The server log showed `{"event":"create_payment_link.paystack_error","code":"PAYSTACK_ERROR","http_status":401}`. Calling the client directly returned `{"ok":false,"code":"PAYSTACK_ERROR","http_status":401,"message":"Invalid key"}`.
- How we found the cause: we inspected the key's shape without printing it. It was 11 characters long, starting `sk_test_` followed by three `.` characters, so `.env` held the placeholder `sk_test_...` rather than a real key. `/health` had reported `paystack_key: "test"` because it only checked the prefix, and the tool server returned a generic `PAYSTACK_ERROR` without Paystack's message.
- Fix: you paste the real test secret key from Paystack Dashboard → Settings → API Keys & Webhooks. `/health` now reports `placeholder` unless the key matches `sk_test_` plus 20 or more alphanumeric characters (TDD: test RED→GREEN).
- Suggestion for Chord: Chord's MCP health probe (`POST .../mcp-servers/{id}/health`) only checks that the server answers. It would have reported `ok` here even though every real tool call would fail. Chord could support an optional, server-declared "deep health" tool (for example `health_check`, read-only) that the probe calls and shows in the app, so a bad downstream credential surfaces at setup and not in the first customer chat.

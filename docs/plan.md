# Mama Tolu's Kitchen Chord Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native: Claude implements in this session). Steps use checkbox (`- [ ]`) syntax. Each step is tagged **[I do]** (Claude) or **[You do]** (Vinny). **[I do · ask first]** means Claude stops and asks before running it, because it touches an account, sends something as you, or spends credits.

**Goal:** Build a stateless MCP tool server on Vercel and a Chord skill. Together they let a Chord teammate take a WhatsApp order, create a Paystack test payment link and confirm the order only when Paystack verifies it as paid.

**Architecture:** A Vercel serverless function at `/mcp` runs the MCP SDK's Streamable HTTP transport in stateless JSON mode. It exposes `get_menu`, `create_payment_link` and `check_payment`. Prices are computed in code from `lib/menu.js`. Paystack is the source of truth: the transaction metadata carries the order and its expected total, so the server needs no database. A Chord skill (`skill/`) holds the order desk's rules.

**Tech Stack:** Node 22 (ESM), `@modelcontextprotocol/sdk`, `zod`, `node:test`, Vercel functions, Paystack REST API (test mode), Chord REST API.

**Spec:** `docs/superpowers/specs/2026-11-20-mama-tolu-design.md` (the menu, zones and error table come from the project brief)

## Global Constraints

- Secrets (`CHORD_API_KEY`, `PAYSTACK_SECRET_KEY`, `MCP_AUTH_TOKEN`) are never printed, logged or committed. `.env` is git-ignored, and `.env.example` lists the names only.
- Only `sk_test_` Paystack keys are allowed. The server refuses keys starting `sk_live_` with `LIVE_KEY_REFUSED`.
- Every tool result is JSON with `ok`, a `status` or `code`, a `customer_message` and a `next_step`.
- Money is stored in kobo internally and shown as `₦4,500` (comma thousands, no decimals).
- Paystack calls time out after 8000 ms.
- The order quantity limit is 1–20 per item. Above 20 returns `BAD_QUANTITY`, and the agent hands the order to the owner.
- The placeholder email is `wa-<phone digits>@<PLACEHOLDER_EMAIL_DOMAIN>`, with the domain defaulting to `example.com`.
- Every real error goes into `FIELD_NOTES_LOG.md` when it happens: exact message, request ID, how the cause was found, the fix and a Chord suggestion.
- Chord API: base URL from `CHORD_BASE_URL` (default `https://api.chordhq.xyz`), with `Authorization: Bearer $CHORD_API_KEY` on every request.

## Review Focus

1. **The same item appears twice in `items[]`** (`jollof-chicken ×1` and `jollof-chicken ×2`). Merge into one line of ×3; the 20-item limit applies to the merged quantity. → Task 2.
2. **The customer names an area, not a zone id** (`"Akoka"`, `"VI"`, `"surulere "`). Resolve case-insensitively to the zone through its areas list; anything unknown returns `UNKNOWN_DELIVERY_ZONE`. → Task 2.
3. **Paystack reports success but the amount or currency is wrong, or the expected total is missing from metadata.** Never return PAID; return `AMOUNT_MISMATCH`. → Task 4.
4. **The reference arrives with spaces or in lowercase** (` mtk-20261120-ab12cd `). Trim and uppercase it before verifying. → Task 4.
5. **Paystack returns `metadata` as a JSON string, not an object.** Parse it before reading `expected_total_kobo`. → Task 4.

---

### Task 1: Project scaffolding **[I do]**

**Files:**
- Create: `package.json`, `.env.example`
- Already done: `.gitignore`, `FIELD_NOTES_LOG.md`, the spec

- [ ] **Step 1 [I do]:** Create `package.json` with `"type": "module"` and `"engines": {"node": ">=20"}`. Add the scripts `"test": "node --test test/"`, `"dev": "node dev/local-server.js"` and `"smoke": "node dev/smoke.js"`. Then run `npm install @modelcontextprotocol/sdk zod`.
- [ ] **Step 2 [I do]:** Create `.env.example` with the empty keys `CHORD_BASE_URL`, `CHORD_API_KEY`, `CHORD_WORKSPACE_ID`, `PAYSTACK_SECRET_KEY`, `MCP_AUTH_TOKEN`, `PLACEHOLDER_EMAIL_DOMAIN` and `CHORD_TEAMMATE_ID`.
- [ ] **Step 3 [I do]:** Run `git status --short`. Expected: `.env` is not listed.
- [ ] **Step 4 [I do]:** Commit with the message `chore: scaffold project`.

### Task 2: Menu and server-side pricing **[I do]**

**Files:**
- Create: `lib/menu.js`
- Test: `test/menu.test.js`

**Interfaces:**
- Produces:
  - `MENU: Array<{id, name, price_ngn, available, category: 'main'|'extra'|'drink'}>` (the 10 items from the brief; `ofada-sauce` has `available: false`)
  - `ZONES: Array<{id, label, areas: string[], fee_ngn, window}>` (yaba, surulere, ikeja, lekki and pickup, with the brief's fees and windows)
  - `MAX_QTY = 20`
  - `formatNaira(n: number) -> string`
  - `resolveZone(input: string) -> zone | null`
  - `priceOrder({items: [{item_id, quantity}], delivery_zone, delivery_address?}) -> {ok: true, lines: [{item_id, name, quantity, unit_price_ngn, line_total_ngn}], subtotal_ngn, delivery_fee_ngn, total_ngn, total_kobo, total_display, zone} | {ok: false, code, detail}`

- [ ] **Step 1 [I do]: Write the failing tests:**
  ```js
  test('prices the demo order', () => {
    const r = priceOrder({ items: [{ item_id: 'jollof-chicken', quantity: 2 }, { item_id: 'zobo', quantity: 2 }],
      delivery_zone: 'yaba', delivery_address: '12 Akoka Rd' });
    assert.equal(r.total_ngn, 11200); assert.equal(r.total_kobo, 1120000); assert.equal(r.total_display, '₦11,200');
  });
  test('sold out', () => assert.equal(priceOrder({ items: [{ item_id: 'ofada-sauce', quantity: 1 }], delivery_zone: 'pickup' }).code, 'SOLD_OUT'));
  test('unknown item', () => assert.equal(priceOrder({ items: [{ item_id: 'shawarma', quantity: 1 }], delivery_zone: 'pickup' }).code, 'UNKNOWN_ITEM'));
  test('bad quantity 0 and 21', ...);           // both 'BAD_QUANTITY'
  test('merges duplicate lines', ...);          // jollof-chicken 1 + 2 → one line qty 3; 15 + 6 → 'BAD_QUANTITY'
  test('area alias resolves', ...);             // resolveZone(' Akoka ').id === 'yaba'; resolveZone('VI').id === 'lekki'
  test('unknown zone', ...);                    // delivery_zone 'abuja' → 'UNKNOWN_DELIVERY_ZONE'
  test('address required except pickup', ...);  // yaba without address → 'ADDRESS_REQUIRED'; pickup without address → ok
  test('empty items', ...);                     // [] → 'BAD_QUANTITY'
  ```
- [ ] **Step 2 [I do]:** Run `npm test`. Expected: FAIL (module not found).
- [ ] **Step 3 [I do]:** Implement `lib/menu.js` with the interfaces above. Quantities may arrive as numeric strings; coerce them with `Number()` and reject anything that is not an integer.
- [ ] **Step 4 [I do]:** Run `npm test`. Expected: all menu tests PASS.
- [ ] **Step 5 [I do]:** Commit with the message `feat: menu and server-side pricing`.

### Task 3: Paystack client and fake Paystack **[I do]**

**Files:**
- Create: `lib/paystack.js`, `dev/fake-paystack.js`
- Test: `test/paystack.test.js`

**Interfaces:**
- Produces:
  - `createPaystackClient({secretKey, baseUrl = 'https://api.paystack.co', timeoutMs = 8000, fetchImpl = fetch}) -> {initialize({email, amount_kobo, reference, metadata}), verify(reference)}`. Each method resolves to `{ok: true, data}` or `{ok: false, code, http_status?, message?}` and never throws.
    - Codes: `CONFIG_MISSING_PAYSTACK_KEY`, `LIVE_KEY_REFUSED`, `PAYSTACK_TIMEOUT`, `PAYSTACK_UNREACHABLE`, `PAYSTACK_EMPTY_RESPONSE`, `PAYSTACK_BAD_RESPONSE`, `PAYSTACK_ERROR` (other 4xx/5xx, carrying Paystack's `message`), `UNKNOWN_REFERENCE` (verify returns 404 or "reference not found").
  - `placeholderEmail(phone?: string, domain = 'example.com') -> string`. A phone gives `wa-2348012345678@example.com`; no phone gives `wa-guest-<random>@...`.
  - `startFakePaystack() -> Promise<{url, close(), state}>`. `state.mode` is one of `'ok'|'500'|'empty'|'garbled'|'slow'`. `state.transactions` is a Map from reference to `{status, amount, currency, metadata, gateway_response}`. It implements `POST /transaction/initialize` and `GET /transaction/verify/:ref` in Paystack's response shape.

- [ ] **Step 1 [I do]: Write the failing tests** against `startFakePaystack()`:
  - `initialize` returns `{ok: true, data.authorization_url, data.reference}`.
  - `verify` on an unknown reference returns `UNKNOWN_REFERENCE`.
  - The modes `500`, `empty`, `garbled` and `slow` (with `timeoutMs: 200`) return `PAYSTACK_ERROR`, `PAYSTACK_EMPTY_RESPONSE`, `PAYSTACK_BAD_RESPONSE` and `PAYSTACK_TIMEOUT` respectively.
  - A `baseUrl` of `http://127.0.0.1:1` returns `PAYSTACK_UNREACHABLE`.
  - `secretKey: ''` returns `CONFIG_MISSING_PAYSTACK_KEY`, and `'sk_live_x'` returns `LIVE_KEY_REFUSED`.
  - The fake receives `Authorization: Bearer sk_test_fake`.
- [ ] **Step 2 [I do]:** Run `npm test`. Expected: the new tests FAIL.
- [ ] **Step 3 [I do]:** Implement both files. The timeout uses `AbortSignal.timeout(timeoutMs)`. The client reads the body as text first: empty text gives `EMPTY` and a `JSON.parse` failure gives `BAD_RESPONSE`.
- [ ] **Step 4 [I do]:** Run `npm test`. Expected: PASS.
- [ ] **Step 5 [I do]:** Commit with the message `feat: paystack client with failure mapping`.

### Task 4: MCP tools **[I do]**

**Files:**
- Create: `lib/server.js`
- Test: `test/server.test.js`

**Interfaces:**
- Consumes: `priceOrder`, `MENU`, `ZONES`, `formatNaira` (Task 2) and `createPaystackClient`, `placeholderEmail` (Task 3).
- Produces:
  - `getMenu() -> {ok, menu, delivery_zones, customer_message, next_step}`
  - `createPaymentLink(input, {paystack, emailDomain, log}) -> result`. The input is `{customer_name, items, delivery_zone, delivery_address?, phone?, email?, notes?}`. The reference format is `MTK-YYYYMMDD-XXXXXX` (6 uppercase base36 characters). Metadata is `{customer_name, phone, items: lines, delivery_zone, delivery_address, notes, expected_total_kobo}`. On success it returns `{ok: true, reference, payment_url, lines, subtotal, delivery_fee, total, total_display, customer_message, next_step}`. A pricing or Paystack failure returns `{ok: false, code, customer_message, next_step}`.
  - `checkPayment({reference}, {paystack, log}) -> {ok, status, reference, amount_display?, reason?, customer_message, next_step}`. Statuses:
    - `PAID`: Paystack status `success`, currency `NGN` and amount equal to `expected_total_kobo`.
    - `NOT_PAID_YET`: `abandoned`.
    - `PENDING`: `ongoing`, `pending`, `processing` or `queued`.
    - `FAILED`: `failed`, with `gateway_response` as the reason.
    - `REVERSED`: `reversed`.
    - `AMOUNT_MISMATCH`: success with any mismatch or missing metadata.
    - `UNKNOWN_REFERENCE`.
    - Any other Paystack code passes through as `{ok: false, code}`.
  - `createMcpServer(deps) -> McpServer` registers the three tools with zod input schemas, and each returns `{content: [{type: 'text', text: JSON.stringify(result)}]}`.
  - `log(event, fields)` writes one JSON line to stdout and never includes keys or tokens.

- [ ] **Step 1 [I do]: Write the failing tests** using the fake from Task 3:
  - The demo order creates a link. The fake receives `amount: 1120000`, and the result carries `total_display: '₦11,200'`.
  - A sold-out item makes no Paystack call.
  - `checkPayment` covers each Paystack status in the table above.
  - Review Focus 3: success with an amount 1 kobo short returns `AMOUNT_MISMATCH`; success with currency `USD` returns `AMOUNT_MISMATCH`; success with no `expected_total_kobo` returns `AMOUNT_MISMATCH`.
  - Review Focus 4: `' mtk-20261120-ab12cd '` verifies as `MTK-20261120-AB12CD`.
  - Review Focus 5: metadata given as a JSON string still gives `PAID`.
  - `getMenu` lists `ofada-sauce` as unavailable.
  - No `customer_message` ever contains the word "confirmed" unless the status is `PAID`.
- [ ] **Step 2 [I do]:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3 [I do]:** Implement `lib/server.js`.
- [ ] **Step 4 [I do]:** Run `npm test`. Expected: PASS.
- [ ] **Step 5 [I do]:** Commit with the message `feat: mcp tools get_menu, create_payment_link, check_payment`.

### Task 5: HTTP entrypoints, local server and smoke test **[I do]**

**Files:**
- Create: `api/mcp.js`, `api/health.js`, `dev/local-server.js`, `dev/smoke.js`
- Test: `test/http.test.js`

**Interfaces:**
- Consumes: `createMcpServer` (Task 4).
- Produces:
  - `api/mcp.js` default `handler(req, res)`:
    - Non-POST returns 405.
    - A missing or wrong bearer token returns 401 (compared with `crypto.timingSafeEqual`).
    - A missing `MCP_AUTH_TOKEN` returns 500 `CONFIG_MISSING_AUTH_TOKEN`.
    - Otherwise it creates a new server and `new StreamableHTTPServerTransport({sessionIdGenerator: undefined, enableJsonResponse: true})`, then calls `transport.handleRequest(req, res, req.body)`.
  - `api/health.js` returns `{ok: true, service: 'mama-tolu-mcp', paystack_key: 'test'|'missing'|'live-refused'}`.
  - `dev/local-server.js` serves `/mcp` and `/health` on `PORT` (default 3000) and loads `.env` with `process.loadEnvFile`.
  - `node dev/smoke.js <baseUrl>` uses `MCP_AUTH_TOKEN` from the environment. It checks that a no-token call returns 401, then runs `initialize`, `tools/list` (expects 3 tools), `get_menu`, `create_payment_link` (the demo order) and `check_payment` (expects `NOT_PAID_YET`). It prints the reference, the URL and PASS or FAIL per check, and exits non-zero on any failure.

- [ ] **Step 1 [I do]: Write the failing tests:**
  - Start the local server against the fake Paystack.
  - A GET returns 405.
  - A POST without a token returns 401.
  - A POST with the token and Accept `application/json, text/event-stream` gets `initialize` → result `serverInfo.name === 'mama-tolu-kitchen'`.
  - `tools/list` returns the names `['check_payment', 'create_payment_link', 'get_menu']` (sorted).
- [ ] **Step 2 [I do]:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3 [I do]:** Implement the four files.
- [ ] **Step 4 [I do]:** Run `npm test`. Expected: all PASS.
- [ ] **Step 5 [I do]:** Commit with the message `feat: vercel entrypoints, local server, smoke test`.

### Task 6: Real Paystack test mode, locally **[I do · ask first]**

- [ ] **Step 1 [I do]:** Generate `MCP_AUTH_TOKEN` (32 random bytes, hex) into `.env` without printing it.
- [ ] **Step 2 [I do · ask first]:** Run `npm run dev` against the real Paystack sandbox, then `node dev/smoke.js http://localhost:3000`. Expected: every check PASSES and a real `MTK-…` reference comes back.
- [ ] **Step 3 [You do]:** Open the printed payment URL and pay with Paystack's **declined** test card, then the **success** card. Take both cards from https://paystack.com/docs/payments/test-payments.
- [ ] **Step 4 [I do]:** Run `check_payment` after each payment. Expected: `FAILED`, then `PAID`. Log anything unexpected (pending behaviour, placeholder email rejection) in `FIELD_NOTES_LOG.md`.

### Task 7: Chord skill **[I do]**

**Files:**
- Create: `skill/SKILL.md`, `skill/references/business.md`

- [ ] **Step 1 [I do]:** Invoke superpowers:writing-skills for structure only.
- [ ] **Step 2 [I do]:** Write `SKILL.md`:
  - Frontmatter is `name: mama-tolu-orders` and `description`.
  - Body: tone (warm, short, `₦4,500`, light Pidgin if the customer uses it, at most 2 emojis), the 8-step order flow from the brief, the brief's failure table mapped to each `status`/`code`, and the "never" list.
  - The first rule, stated first: "Never confirm an order unless check_payment returns PAID; a screenshot is not proof."
- [ ] **Step 3 [I do]:** Write `references/business.md`: hours, address, delivery windows, prepaid-only, refunds and complaints go to the owner, allergy notes (ask before promising; the owner answers).
- [ ] **Step 4 [I do]:** Check the package against Chord's limits: entrypoint under 64,000 characters, total under 256 KiB, `.md` files only, strict UTF-8. Expected: `wc -c skill/**/*.md` stays well under the limits.
- [ ] **Step 5 [I do]:** Commit with the message `feat: mama-tolu-orders chord skill`.

### Task 8: Public GitHub repo **[I do · ask first]**

- [ ] **Step 1 [I do]:** Run `git log --all -p | grep -E "sk_(test|live)_[A-Za-z0-9]{10}"` and the same pattern for the Chord key. Expected: no matches.
- [ ] **Step 2 [You do]:** Approve the repo name `mama-tolu-chord-agent` and public visibility.
- [ ] **Step 3 [I do · ask first]:** Run `gh repo create mama-tolu-chord-agent --public --source . --push`. Expected: the repo URL is printed.

### Task 9: Deploy to Vercel **[I do · ask first]**

- [ ] **Step 1 [You do]:** Run `npx vercel login` in the terminal, or approve the login link I open.
- [ ] **Step 2 [I do · ask first]:** Run `npx vercel link` to create the project, then use `npx vercel env add` to add `PAYSTACK_SECRET_KEY` and `MCP_AUTH_TOKEN` (production), piping the values from `.env` so they are never echoed.
- [ ] **Step 3 [I do · ask first]:** Run `npx vercel --prod`. Expected: the production URL is printed.
- [ ] **Step 4 [I do]:** Run `curl <url>/health`. Expected: `paystack_key: "test"`. Then run `node dev/smoke.js <url>`. Expected: all PASS. Log every real error (build, routing, body parsing, env) in `FIELD_NOTES_LOG.md`.
- [ ] **Step 5 [I do]:** Commit any fixes and push.

### Task 10: Teammate in Chord and questions for TSG **[You do]**

- [ ] **Step 1 [I do]:** Draft `docs/tsg-questions.md` with the brief's 3 questions: how to connect the WhatsApp simulator, whether a remote MCP server is the intended path for custom tools, and the API key scopes (`mcp:create`, `mcp:manage`, `teammate:update`, `orchestrator:chat`).
- [ ] **Step 2 [You do]:** Send those questions to your TSG contact.
- [ ] **Step 3 [You do]:** Create the teammate "Mama Tolu Order Desk" in the Chord app. API creation needs `teammate:create`, which normal keys lack. Add `CHORD_TEAMMATE_ID=<id>` to `.env` and tell me.

### Task 11: Wire the tool and skill into Chord **[I do · ask first]**

**Files:**
- Create: `scripts/chord.mjs`

**Interfaces:**
- `node scripts/chord.mjs <command>` loads `.env` and prints status, the response body without secrets and the `x-request-id` header if present. Commands:
  - `register-mcp <url>`: `POST /v1/workspaces/{ws}/mcp-servers` with `{name: 'mama-tolu-kitchen', url: '<url>/mcp', transport: 'streamable_http', auth_type: 'bearer', auth_token}`. Saves the `mcp-…` id into `.env` as `CHORD_MCP_SERVER_ID`.
  - `health`: `POST .../mcp-servers/{id}/health`. Passes only if `status === 'ok'`.
  - `tools`: `POST .../mcp-servers/{id}/tools`. Expects 3 tools.
  - `assign`: `PUT /v1/teammates/{tm}` with `{add_mcp_server_ids: [id]}`. Never an empty list.
  - `upload-skill`: `POST /v1/teammates/{tm}/skills` with `{name, entrypoint: 'SKILL.md', files: [{path, content}], idempotency_key}`, then `POST .../skills/{id}/publish` with `{expected_version, summary, idempotency_key}`.
  - `chat "<text>" [--session <uuid>]`: `POST /v1/external-chat/messages` with `{workspace_id, teammate_id, sender_id: 'test-customer', session_id, text}`. Without `--session`, it uses a new UUID and prints it.

- [ ] **Step 1 [I do]:** Write `scripts/chord.mjs`.
- [ ] **Step 2 [I do · ask first]:** Run `register-mcp`, `health`, `tools` and `assign` in that order. Expected: health ok, 3 tools, teammate shows the server id. Log every real error.
- [ ] **Step 3 [I do · ask first]:** Run `upload-skill`. Expected: the skill is published and included.
- [ ] **Step 4 [I do]:** Commit with the message `feat: chord wiring script`.

### Task 12: API conversation tests **[I do · ask first, uses credits]**

- [ ] **Step 1 [I do · ask first]:** Run 5 short conversations with `chat`, one session id each: happy path to a link, sold-out ofada, an unknown area (Abuja), "I've paid" with no payment (expected: check_payment → NOT_PAID_YET, no confirmation), and a quantity of 25.
- [ ] **Step 2 [I do]:** Read the `steps` in each response. Expected: `check_payment` is called before any confirmation, and prices match the tool's numbers. Tighten the `SKILL.md` wording and re-publish if not.
- [ ] **Step 3 [I do]:** Report the credits used with `GET /v1/usage`.

### Task 13: WhatsApp simulator **[You do + I do]**

- [ ] **Step 1 [You do]:** Connect the teammate at https://chat.tsglabs.dev/ the way TSG says (Sign in with Chord).
- [ ] **Step 2 [You do]:** Run the demo script: order → link → declined card → "paid" → FAILED → success card → "paid" → confirmed.
- [ ] **Step 3 [I do]:** Watch the Vercel logs during the run (`npx vercel logs <url>`), and log any problems.

### Task 14: Submission docs **[I draft, you edit]**

**Files:**
- Create: `README.md`, `FIELD_NOTES.md`, `GO_LIVE.md`

- [ ] **Step 1 [I do]:** Write `README.md`. It covers:
  - the role and problem statement at the top
  - the architecture
  - running locally in under 10 minutes (`npm i`, `.env`, `npm test`, `npm run dev`, smoke)
  - deploying
  - the env vars
  - the Paystack test cards
  - the Chord setup (`scripts/chord.mjs`)
  - "How I used AI tools", stating honestly that Claude wrote most of the code
- [ ] **Step 2 [I do]:** Write `FIELD_NOTES.md`: the 2–3 strongest real entries from `FIELD_NOTES_LOG.md`, each with a concrete Chord fix.
- [ ] **Step 3 [I do]:** Write `GO_LIVE.md` (half a page for Mama Tolu): live keys and Paystack business verification, a WhatsApp Business number, webhook confirmation, failure alerts, menu updates.
- [ ] **Step 4 [You do]:** Edit all three in your own voice.
- [ ] **Step 5 [I do · ask first]:** Commit and push.

### Task 15: Record and submit **[You do]**

- [ ] **Step 1 [You do]:** Rehearse twice, then record 3 minutes following the brief's demo script.
- [ ] **Step 2 [You do]:** Leave the agent live and send the submission.

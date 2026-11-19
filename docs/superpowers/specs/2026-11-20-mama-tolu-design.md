# Mama Tolu's Kitchen WhatsApp order agent: design

Date: 2026-11-20 · Status: approved

## Intent
A submission for the TSG Labs build exercise, for the Forward-deployed Engineer role. A Chord teammate turns a WhatsApp chat into a paid, confirmed food order for a fictional Yaba, Lagos kitchen. It confirms an order only when Paystack (test mode) verifies payment, never on a screenshot. Integration and deployment field notes carry the most weight.

## Goals
- Run the job end to end: menu, order, server-side price, Paystack link, verify, confirm.
- Run a real Paystack test transaction from the WhatsApp simulator, covering the declined and then paid paths.
- Handle every failure the brief lists without ever confirming the order.
- Record 2–3 real deployment problems as field notes, each with a concrete Chord fix.

## Non-goals
Rider dispatch, refunds, inventory updates, an owner dashboard, payment webhooks (the first add-on if time allows), multiple branches or languages, and a real WhatsApp number.

## Anti-goals
- The model invents a price, or the amount charged differs from what the server computed.
- The agent confirms an order without a PAID status from check_payment.
- A secret is printed, logged or committed. Live keys are never used.

## Constraints
About 6 hours of work and up to 50 Chord credits. Chord custom tools must be remote MCP servers using Streamable HTTP at a public HTTPS URL. Skills are uploaded through the API as JSON files, saved as a draft, then published. Creating a teammate needs the `teammate:create` scope, which normal API keys lack, so it is done in the app.

## Approaches
1. **Stateless MCP server on Vercel, with Paystack as the source of truth.** Chosen. No database is needed: the order and its expected total go in the Paystack transaction metadata, and verification compares the paid amount against that metadata.
2. **An MCP server with its own order database** (KV or Postgres). It allows webhooks and order history, but it adds a second integration and more setup without strengthening the payment proof. Rejected for now.
3. **A long-running server** (Render or Fly) instead of Vercel. It would support SSE sessions, but Chord only needs JSON POSTs, and Vercel deploys in minutes. Rejected.

## Design
- **Server:** Node ESM using `@modelcontextprotocol/sdk`. Each request gets a new `McpServer` and a stateless `StreamableHTTPServerTransport` with `enableJsonResponse: true`. `api/mcp.js` accepts POST only and requires `Authorization: Bearer $MCP_AUTH_TOKEN`, otherwise it returns 401. `api/health.js` is a simple liveness check.
- **`lib/menu.js`:** the menu and delivery zones from the brief. `priceOrder()` validates the order and returns lines, subtotal, delivery fee and total in naira and kobo. It returns these errors: SOLD_OUT, UNKNOWN_ITEM, BAD_QUANTITY (≤0 or >20), UNKNOWN_DELIVERY_ZONE, ADDRESS_REQUIRED.
- **`lib/paystack.js`:** a fetch client with an 8 s timeout. It refuses `sk_live_` keys and maps transport failures to PAYSTACK_TIMEOUT, PAYSTACK_UNREACHABLE, PAYSTACK_EMPTY_RESPONSE and PAYSTACK_BAD_RESPONSE. A missing key returns CONFIG_MISSING_PAYSTACK_KEY. If the customer gives no email, it uses `wa-<phone digits>@example.com` (domain configurable through `PLACEHOLDER_EMAIL_DOMAIN`).
- **`lib/server.js`:** three tools. Every result is JSON with `ok`, a status or code, a `customer_message` and a `next_step`.
  - get_menu returns the menu and delivery zones.
  - create_payment_link returns the reference, payment URL and price lines.
  - check_payment returns PAID, NOT_PAID_YET, PENDING, FAILED, AMOUNT_MISMATCH, REVERSED or UNKNOWN_REFERENCE.
- **Logging:** event names and references only.
- **Skill:** `skill/SKILL.md` (`name: mama-tolu-orders`) and `skill/references/business.md`. It covers tone, the 8-step order flow, the failure table and the "never" list.
- **Scripts:** in `scripts/`, they register the MCP server, run the health check and tool discovery, assign the server by `add_mcp_server_ids`, upload and publish the skill, and run API chat with a fresh UUID `session_id` for each run.

## Left to the builder
Exact customer_message wording, the internal structure of the tests, and the script ergonomics.

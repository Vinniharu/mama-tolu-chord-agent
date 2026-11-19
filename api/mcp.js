// Vercel function: the MCP endpoint Chord calls (rewritten from /mcp).
// Stateless Streamable HTTP with JSON responses; a fresh server per request.
import { timingSafeEqual } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer, log } from '../lib/server.js';
import { createPaystackClient } from '../lib/paystack.js';

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

function tokenMatches(header, expected) {
  const given = Buffer.from(String(header ?? ''));
  const want = Buffer.from(`Bearer ${expected}`);
  return given.length === want.length && timingSafeEqual(given, want);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed. POST JSON-RPC to this endpoint.' }, { Allow: 'POST' });
  }
  const expected = process.env.MCP_AUTH_TOKEN;
  if (!expected) {
    log('mcp.config_error', { code: 'CONFIG_MISSING_AUTH_TOKEN' });
    return sendJson(res, 500, { error: 'Server is not configured', code: 'CONFIG_MISSING_AUTH_TOKEN' });
  }
  if (!tokenMatches(req.headers.authorization, expected)) {
    log('mcp.unauthorized', { has_auth_header: Boolean(req.headers.authorization) });
    return sendJson(res, 401, { error: 'Unauthorized' }, { 'WWW-Authenticate': 'Bearer' });
  }

  const paystack = createPaystackClient({
    secretKey: process.env.PAYSTACK_SECRET_KEY,
    ...(process.env.PAYSTACK_BASE_URL ? { baseUrl: process.env.PAYSTACK_BASE_URL } : {}),
  });
  const server = createMcpServer({ paystack, emailDomain: process.env.PLACEHOLDER_EMAIL_DOMAIN || 'example.com', log });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { transport.close(); server.close(); });

  try {
    await server.connect(transport);
    log('mcp.request', { method: req.body?.method, tool: req.body?.params?.name });
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    log('mcp.error', { message: err?.message });
    if (!res.headersSent) sendJson(res, 500, { jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
  }
}

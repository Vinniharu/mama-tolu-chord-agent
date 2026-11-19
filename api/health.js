// Vercel function: quick liveness check (rewritten from /health). Never exposes the key.
export default function handler(req, res) {
  const key = process.env.PAYSTACK_SECRET_KEY ?? '';
  const paystack_key = !key ? 'missing' : key.startsWith('sk_live_') ? 'live-refused' : 'test';
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ ok: true, service: 'mama-tolu-mcp', paystack_key }));
}

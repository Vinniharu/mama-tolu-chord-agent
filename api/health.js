// Vercel function: quick liveness check (rewritten from /health). Never exposes the key.
export default function handler(req, res) {
  const key = process.env.PAYSTACK_SECRET_KEY ?? '';
  // A real key is sk_test_ plus a long alphanumeric string; "sk_test_..." or "sk_test_xxx" is a placeholder.
  const paystack_key = !key ? 'missing'
    : key.startsWith('sk_live_') ? 'live-refused'
    : !/^sk_test_[A-Za-z0-9]{20,}$/.test(key) ? 'placeholder'
    : 'test';
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ ok: true, service: 'mama-tolu-mcp', paystack_key }));
}

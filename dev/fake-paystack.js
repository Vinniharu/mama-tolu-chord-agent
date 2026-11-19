// A local stand-in for the Paystack API, used by tests and local runs.
// state.mode: 'ok' | '500' | 'empty' | 'garbled' | 'slow'
// state.transactions: Map(reference -> {status, amount, currency, metadata, gateway_response})
import http from 'node:http';

export async function startFakePaystack({ port = 0 } = {}) {
  const state = { mode: 'ok', transactions: new Map(), calls: 0, lastAuth: null, lastBody: null };

  const server = http.createServer(async (req, res) => {
    state.calls++;
    state.lastAuth = req.headers.authorization ?? null;
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };

    if (state.mode === '500') return send(500, { status: false, message: 'Internal server error' });
    if (state.mode === 'empty') return send(200, '');
    if (state.mode === 'garbled') return send(200, '<html>502 Bad Gateway</html>');
    if (state.mode === 'slow') await new Promise((r) => setTimeout(r, 1000));
    if (res.destroyed) return;

    if (req.method === 'POST' && req.url === '/transaction/initialize') {
      const body = raw ? JSON.parse(raw) : {};
      state.lastBody = body;
      if (!body.email || !body.amount) return send(400, { status: false, message: 'Invalid email or amount' });
      const reference = body.reference ?? `FAKE-${state.transactions.size + 1}`;
      state.transactions.set(reference, {
        status: 'abandoned', amount: body.amount, currency: body.currency ?? 'NGN',
        metadata: body.metadata ?? null, gateway_response: 'The transaction was not completed',
      });
      const host = `http://${req.headers.host}`;
      return send(200, { status: true, message: 'Authorization URL created', data: { authorization_url: `${host}/pay/${reference}`, access_code: 'fake_access', reference } });
    }

    const m = req.method === 'GET' && req.url.match(/^\/transaction\/verify\/(.+)$/);
    if (m) {
      const reference = decodeURIComponent(m[1]);
      const tx = state.transactions.get(reference);
      if (!tx) return send(400, { status: false, message: 'Transaction reference not found', code: 'transaction_not_found' });
      return send(200, { status: true, message: 'Verification successful', data: { reference, ...tx, paid_at: tx.status === 'success' ? new Date().toISOString() : null } });
    }

    send(404, { status: false, message: 'Not found' });
  });

  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url,
    state,
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
  };
}

// `node dev/fake-paystack.js` runs it standalone on port 4010.
if (process.argv[1]?.endsWith('fake-paystack.js')) {
  const fake = await startFakePaystack({ port: Number(process.env.FAKE_PAYSTACK_PORT ?? 4010) });
  console.log(`fake paystack on ${fake.url}`);
}

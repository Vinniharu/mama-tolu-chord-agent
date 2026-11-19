// Minimal Paystack client. Every method resolves to {ok:true,data} or {ok:false,code,...}
// and never throws, so the tools can always answer the agent with a clear status.
// The secret key is only ever placed in the Authorization header; it is never logged.
import { randomBytes } from 'node:crypto';

export function placeholderEmail(phone, domain = 'example.com') {
  const digits = typeof phone === 'string' ? phone.replace(/\D/g, '') : '';
  const local = digits ? `wa-${digits}` : `wa-guest-${randomBytes(4).toString('hex')}`;
  return `${local}@${domain}`;
}

export function createPaystackClient({ secretKey, baseUrl = 'https://api.paystack.co', timeoutMs = 8000, fetchImpl = fetch } = {}) {
  function keyProblem() {
    if (!secretKey) return { ok: false, code: 'CONFIG_MISSING_PAYSTACK_KEY' };
    if (secretKey.startsWith('sk_live_')) return { ok: false, code: 'LIVE_KEY_REFUSED' };
    return null;
  }

  async function call(method, path, body) {
    const problem = keyProblem();
    if (problem) return problem;

    let res;
    try {
      res = await fetchImpl(baseUrl + path, {
        method,
        headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return { ok: false, code: 'PAYSTACK_TIMEOUT' };
      return { ok: false, code: 'PAYSTACK_UNREACHABLE', message: err?.cause?.code ?? err?.message };
    }

    let text;
    try {
      text = await res.text();
    } catch (err) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return { ok: false, code: 'PAYSTACK_TIMEOUT' };
      return { ok: false, code: 'PAYSTACK_UNREACHABLE', message: err?.message };
    }
    if (!text.trim()) return { ok: false, code: 'PAYSTACK_EMPTY_RESPONSE', http_status: res.status };

    let json;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, code: 'PAYSTACK_BAD_RESPONSE', http_status: res.status };
    }

    if (res.ok && json?.status === true && json.data) return { ok: true, data: json.data };
    const message = typeof json?.message === 'string' ? json.message : undefined;
    if (method === 'GET' && path.startsWith('/transaction/verify/') && (res.status === 404 || /not found/i.test(message ?? ''))) {
      return { ok: false, code: 'UNKNOWN_REFERENCE', http_status: res.status, message };
    }
    if (res.ok) return { ok: false, code: 'PAYSTACK_BAD_RESPONSE', http_status: res.status, message };
    return { ok: false, code: 'PAYSTACK_ERROR', http_status: res.status, message };
  }

  return {
    initialize({ email, amount_kobo, reference, metadata }) {
      return call('POST', '/transaction/initialize', { email, amount: amount_kobo, currency: 'NGN', reference, metadata });
    },
    verify(reference) {
      return call('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
    },
  };
}

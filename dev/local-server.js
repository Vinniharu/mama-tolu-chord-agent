// Local stand-in for Vercel: serves /mcp and /health with the same handlers.
// `npm run dev` loads .env and listens on PORT (default 3000).
// Set PAYSTACK_BASE_URL=http://127.0.0.1:4010 and run `node dev/fake-paystack.js` to use the fake.
import http from 'node:http';
import { existsSync } from 'node:fs';
import mcpHandler from '../api/mcp.js';
import healthHandler from '../api/health.js';

export function createLocalServer() {
  return http.createServer(async (req, res) => {
    const path = req.url.split('?')[0];
    if (path === '/health' || path === '/api/health') return healthHandler(req, res);
    if (path === '/mcp' || path === '/api/mcp') {
      if (req.method === 'POST') {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        try {
          req.body = raw ? JSON.parse(raw) : undefined;
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }));
        }
      }
      return mcpHandler(req, res);
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });
}

if (process.argv[1]?.endsWith('local-server.js')) {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const port = Number(process.env.PORT ?? 3000);
  createLocalServer().listen(port, () => console.log(`MCP server on http://localhost:${port}/mcp (health: /health)`));
}

// Run check_payment through the running server: node dev/check.js <reference> [baseUrl]
import { existsSync } from 'node:fs';
if (existsSync('.env')) process.loadEnvFile('.env');
const [reference, base = 'http://localhost:3000'] = process.argv.slice(2);
const res = await fetch(`${base.replace(/\/$/, '')}/mcp`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${process.env.MCP_AUTH_TOKEN}` },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'check_payment', arguments: { reference } } }),
});
const body = await res.json();
console.log(JSON.stringify(JSON.parse(body.result.content[0].text), null, 2));

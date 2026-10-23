#!/usr/bin/env node
// OfficeX tools for an agent, as a stdio MCP server (JSON-RPC, one message per line).
// Claude Code starts this per turn from the agent's .officex/mcp.json. Every call is forwarded to the
// OfficeX server, which knows which agent and turn the token belongs to. No dependencies.

const URL_BASE = process.env.OFFICEX_URL || 'http://127.0.0.1:80';
const TOKEN = process.env.OFFICEX_TURN_TOKEN || '';

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

async function call(path, body) {
  const res = await fetch(`${URL_BASE}/api/internal/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-officex-turn': TOKEN },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined) return; // notifications (initialized, cancelled) need no answer
  try {
    if (method === 'initialize') {
      return send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: params?.protocolVersion || '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'officex', version: '1.0.0' },
        },
      });
    }
    if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
    if (method === 'tools/list') {
      const { tools } = await call('tools/list');
      return send({ jsonrpc: '2.0', id, result: { tools } });
    }
    if (method === 'tools/call') {
      try {
        const r = await call('tools/call', { name: params?.name, arguments: params?.arguments ?? {} });
        return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: String(r.text ?? 'done') }], isError: !!r.isError } });
      } catch (err) {
        return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `OfficeX error: ${err.message}` }], isError: true } });
      }
    }
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
  } catch (err) {
    send({ jsonrpc: '2.0', id, error: { code: -32603, message: err.message } });
  }
}

let buf = '';
process.stdin.on('data', (d) => {
  buf += d.toString('utf8');
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    try {
      handle(JSON.parse(line));
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    }
  }
});
process.stdin.on('end', () => process.exit(0));

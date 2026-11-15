// Run from this directory's parent: node examples/server.mjs
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { createHorizonsProvider, createSerialQueue } from '../dist/horizons.js';
import { createObservationHandler } from '../dist/server.js';

const queue = createSerialQueue(); // ONE queue for all NASA clients in this process.
const provider = createHorizonsProvider({ queue,
  userAgent: process.env.TANAW_USER_AGENT ?? 'TanawComputationEngine/0.1 (https://github.com/ruzcko/gabay-tanaw)' });
const handler = createObservationHandler(provider);
const server = createServer(async (req, res) => {
  const controller = new AbortController();
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });
  if (req.url !== '/api/observation') { res.writeHead(404); res.end(); return; }
  try {
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(',') : value);
    const request = new Request('http://localhost/api/observation', {
      method: req.method, headers, signal: controller.signal,
      ...(req.method === 'GET' || req.method === 'HEAD' ? {} : { body: Readable.toWeb(req), duplex: 'half' })
    });
    const response = await handler(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
  } catch { if (!res.destroyed) { res.writeHead(500); res.end('Request failed'); } }
});
server.requestTimeout = 120000;
server.listen(Number(process.env.PORT ?? 4181), process.env.HOST ?? '127.0.0.1', () => console.log('Tanaw computation backend ready'));

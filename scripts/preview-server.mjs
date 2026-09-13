import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import snapshotModule from '../src/main/snapshot.cjs';

const root = join(process.cwd(), 'src', 'renderer');
const port = Number(process.env.QUOTADECK_PREVIEW_PORT || 4173);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

createServer(async (request, response) => {
  if (request.url === '/snapshot') {
    const snapshot = await snapshotModule.readAll();
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(snapshot));
    return;
  }
  const requestPath = request.url === '/' ? '/compact.html' : request.url.split('?')[0];
  const file = normalize(join(root, requestPath));
  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404).end('Not found');
    return;
  }
  response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
  createReadStream(file).pipe(response);
}).listen(port, '127.0.0.1', () => {
  console.log(`QuotaDeck preview: http://127.0.0.1:${port}/`);
});

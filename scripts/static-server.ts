import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, resolve, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

/** Serves the production build on loopback, for tests. Resolves to the port it chose. */
export function serve(directory: string): Promise<{ server: Server; url: string }> {
  const root = resolve(directory);
  const server = createServer((request, response) => {
    let path: string;
    try {
      path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    } catch {
      response.writeHead(400).end();
      return;
    }
    const file = resolve(root, path.endsWith('/') ? `.${path}index.html` : `.${path}`);
    if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(response);
  });
  return new Promise((done) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as { port: number };
      done({ server, url: `http://127.0.0.1:${address.port}/` });
    });
  });
}

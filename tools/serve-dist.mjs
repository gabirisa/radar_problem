import { createReadStream, existsSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { createServer } from 'node:http';

const root = resolve('dist/fastidios/browser');
const port = Number(process.env.PORT ?? 4200);
const host = process.env.HOST ?? '127.0.0.1';

const types = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
]);

createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${host}:${port}`);
  const pathname = decodeURIComponent(url.pathname);
  const requested = normalize(join(root, pathname));
  const file = requested.startsWith(root) && existsSync(requested) && !pathname.endsWith('/')
    ? requested
    : join(root, 'index.html');
  const contentType = types.get(extname(file)) ?? 'application/octet-stream';

  response.writeHead(200, { 'Content-Type': contentType });
  createReadStream(file).pipe(response);
}).listen(port, host, () => {
  console.log(`Fastidios build available at http://${host}:${port}/`);
});

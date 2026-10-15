import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import worker from './src/worker.mjs';

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.resolve('public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
};

const ASSETS = {
  async fetch(request) {
    const url = new URL(request.url);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/' || pathname === '') {
      pathname = '/index.html';
    }
    const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
    const filePath = path.join(PUBLIC_DIR, safePath);

    if (!filePath.startsWith(PUBLIC_DIR)) {
      return new Response('Forbidden', { status: 403 });
    }

    try {
      const stat = await fs.promises.stat(filePath);
      let targetPath = filePath;
      if (stat.isDirectory()) {
        targetPath = path.join(filePath, 'index.html');
      }
      const ext = path.extname(targetPath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const content = await fs.promises.readFile(targetPath);
      return new Response(content, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(content.byteLength),
          'Cache-Control': 'no-cache',
        },
      });
    } catch {
      return new Response('Not Found', { status: 404 });
    }
  },
};

const DB_DIR = path.resolve('data');
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}
const db = new DatabaseSync(path.join(DB_DIR, 'oef23.db'));

const DB = {
  prepare(sql) {
    const stmt = db.prepare(sql);
    let args = [];
    return {
      bind(...a) {
        args = a;
        return this;
      },
      async run() {
        const r = stmt.run(...args);
        return { meta: { changes: r.changes } };
      },
      async first() {
        return stmt.get(...args) || null;
      },
      async all() {
        return { results: stmt.all(...args) };
      },
    };
  },
  async batch(statements) {
    db.exec('BEGIN');
    try {
      const results = [];
      for (const stmt of statements) {
        results.push(await stmt.run());
      }
      db.exec('COMMIT');
      return results;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  },
};

const env = {
  ASSETS,
  DB,
  GITHUB_RUN_NUMBER: process.env.GITHUB_RUN_NUMBER,
  BUILD_NUMBER: process.env.BUILD_NUMBER,
};

const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

let activeRequests = 0;
let shuttingDown = false;

const server = http.createServer(async (req, res) => {
  if (shuttingDown) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Server is shutting down' }));
    return;
  }
  activeRequests++;
  res.on('finish', () => { activeRequests--; });
  try {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);

    const proto = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
    const fullUrl = `${proto}://${host}${req.url}`;

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) {
        for (const v of value) headers.append(key, v);
      } else if (value !== undefined) {
        headers.set(key, value);
      }
    }

    const webReq = new Request(fullUrl, {
      method: req.method,
      headers,
      body: (req.method !== 'GET' && req.method !== 'HEAD') ? body : undefined,
    });

    const webRes = await worker.fetch(webReq, env);

    res.statusCode = webRes.status;

    if (typeof webRes.headers.getSetCookie === 'function') {
      const cookies = webRes.headers.getSetCookie();
      if (cookies.length) {
        res.setHeader('Set-Cookie', cookies);
      }
    } else {
      const setCookie = webRes.headers.get('set-cookie');
      if (setCookie) {
        res.setHeader('Set-Cookie', setCookie);
      }
    }

    const arrayBuffer = await webRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    for (const [key, value] of webRes.headers.entries()) {
      const lower = key.toLowerCase();
      if (lower !== 'set-cookie' && lower !== 'content-length') {
        res.setHeader(key, value);
      }
    }

    for (const [key, value] of Object.entries(securityHeaders)) {
      res.setHeader(key, value);
    }

    res.setHeader('Content-Length', String(buffer.byteLength));
    res.end(buffer);
  } catch (err) {
    console.error('Unhandled request error:', err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Internal Server Error' }));
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`OEF-23 Server running on http://${HOST}:${PORT}`);
});

function gracefulShutdown(signal) {
  console.log(`Received ${signal}, draining ${activeRequests} in-flight request(s)...`);
  shuttingDown = true;
  server.close(() => {
    console.log('All connections drained. Exiting.');
    process.exit(0);
  });
  setTimeout(() => {
    console.error('Forced shutdown after timeout.');
    process.exit(1);
  }, 30000).unref();
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

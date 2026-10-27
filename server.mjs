import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import worker from './src/worker.mjs';
import { pushFileToGitHub } from './src/github.mjs';

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
    let filePath;
    if (pathname.startsWith('/database/')) {
      const rel = pathname.replace(/^\/database\/?/, '');
      filePath = path.join(path.resolve('database'), rel);
      if (!filePath.startsWith(path.resolve('database'))) {
        return new Response('Forbidden', { status: 403 });
      }
    } else {
      filePath = path.join(PUBLIC_DIR, safePath);
      if (!filePath.startsWith(PUBLIC_DIR)) {
        return new Response('Forbidden', { status: 403 });
      }
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

function seedDatabase(database) {
  try {
    database.exec("CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY, salt TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','user','viewer')), created_at TEXT NOT NULL)");
    database.exec("CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, username TEXT NOT NULL, expires_at INTEGER NOT NULL)");
    database.exec("CREATE TABLE IF NOT EXISTS login_limits (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL)");
    database.exec("CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, report_no TEXT NOT NULL UNIQUE, data TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1)");

    const table = database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
    if (table && table.sql && !table.sql.includes('viewer')) {
      database.exec("CREATE TABLE users_migrated (username TEXT PRIMARY KEY, salt TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','user','viewer')), created_at TEXT NOT NULL)");
      database.exec("INSERT INTO users_migrated (username,salt,password_hash,role,created_at) SELECT username,salt,password_hash,role,created_at FROM users");
      database.exec("DROP TABLE users");
      database.exec("ALTER TABLE users_migrated RENAME TO users");
    }

    const usersSeedPaths = [
      path.resolve('database/db_users.json'),
      path.resolve('src/data/seed_users.json'),
      path.resolve('public/assets/aistudio/db_users_97374d65.json')
    ];
    for (const p of usersSeedPaths) {
      if (fs.existsSync(p)) {
        try {
          const content = JSON.parse(fs.readFileSync(p, 'utf8'));
          const usersList = content.users || (Array.isArray(content) ? content : []);
          const stmtUser = database.prepare("INSERT INTO users (username, salt, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(username) DO UPDATE SET salt=excluded.salt, password_hash=excluded.password_hash, role=excluded.role");
          for (const u of usersList) {
            if (u.username && u.password_hash && u.salt) {
              stmtUser.run(String(u.username).trim().toLowerCase(), u.salt, u.password_hash, u.role || 'user', u.created_at || new Date().toISOString());
            }
          }
          break;
        } catch (e) {
          console.error('Failed to seed users from', p, e.message);
        }
      }
    }

    const registrySeedPaths = [
      path.resolve('database/db_registry.json'),
      path.resolve('src/data/seed_registry.json'),
      path.resolve('public/assets/aistudio/db_registry_53c25b25.json'),
      path.resolve('public/assets/aistudio/db_registry_3808e951.json')
    ];
    const aistudioDir = path.resolve('public/assets/aistudio');
    if (fs.existsSync(aistudioDir)) {
      try {
        const extra = fs.readdirSync(aistudioDir)
          .filter(f => f.startsWith('db_registry_') && f.endsWith('.json'))
          .map(f => path.join(aistudioDir, f));
        for (const f of extra) {
          if (!registrySeedPaths.includes(f)) registrySeedPaths.push(f);
        }
      } catch {}
    }
    for (const p of registrySeedPaths) {
      if (fs.existsSync(p)) {
        try {
          const content = JSON.parse(fs.readFileSync(p, 'utf8'));
          const reportsList = content.reports || (Array.isArray(content) ? content : []);
          const stmtReport = database.prepare("INSERT INTO reports (id, report_no, data, version) VALUES (?, ?, ?, ?) ON CONFLICT(report_no) DO UPDATE SET data=excluded.data, version=excluded.version");
          for (const r of reportsList) {
            if (r.reportNo) {
              const { id, reportNo, _version, ...rest } = r;
              const repId = id || crypto.randomUUID();
              const formattedNo = String(reportNo).padStart(3, '0');
              const version = _version || 1;
              stmtReport.run(repId, formattedNo, JSON.stringify({ ...rest, reportNo: formattedNo }), version);
            }
          }
          break;
        } catch (e) {
          console.error('Failed to seed reports from', p, e.message);
        }
      }
    }
  } catch (err) {
    console.error('Database initialization/seeding warning:', err);
  }
}

seedDatabase(db);

function persistSeedBackup(database) {
  try {
    const reports = database.prepare('SELECT id, report_no, data, version FROM reports ORDER BY CAST(report_no AS INTEGER) DESC').all();
    let registryJson = null;
    let latestReportNo = '';
    if (reports && reports.length) {
      const unpacked = reports.map(r => ({
        ...JSON.parse(r.data),
        id: r.id,
        reportNo: r.report_no,
        _version: r.version
      }));
      latestReportNo = unpacked[0]?.reportNo || '';
      registryJson = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), reports: unpacked }, null, 2);

      const dbDir = path.resolve('database');
      if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
      fs.writeFileSync(path.join(dbDir, 'db_registry.json'), registryJson);

      const regDir = path.resolve('src/data');
      if (!fs.existsSync(regDir)) fs.mkdirSync(regDir, { recursive: true });
      fs.writeFileSync(path.join(regDir, 'seed_registry.json'), registryJson);
    }
    const users = database.prepare('SELECT username, salt, password_hash, role, created_at FROM users ORDER BY username').all();
    let usersJson = null;
    if (users && users.length) {
      usersJson = JSON.stringify({ version: 1, type: 'oef23_users_backup', exportedAt: new Date().toISOString(), users }, null, 2);

      const dbDir = path.resolve('database');
      if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
      fs.writeFileSync(path.join(dbDir, 'db_users.json'), usersJson);

      const usersDir = path.resolve('src/data');
      if (!fs.existsSync(usersDir)) fs.mkdirSync(usersDir, { recursive: true });
      fs.writeFileSync(path.join(usersDir, 'seed_users.json'), usersJson);
    }

    if (registryJson) {
      pushFileToGitHub('database/db_registry.json', registryJson, `Auto-commit: update database/db_registry.json (latest report #${latestReportNo})`).catch(err => {
        console.warn('[GitHub Auto-Commit] Error syncing registry:', err.message);
      });
    }
    if (usersJson) {
      pushFileToGitHub('database/db_users.json', usersJson, 'Auto-commit: update database/db_users.json').catch(err => {
        console.warn('[GitHub Auto-Commit] Error syncing users:', err.message);
      });
    }
  } catch (err) {
    console.error('persistSeedBackup error:', err);
  }
}

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

    let proto = req.headers['x-forwarded-proto'] || 'http';
    let host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
    if (req.headers.origin) {
      try {
        const oUrl = new URL(req.headers.origin);
        if ((host.startsWith('localhost') || host.startsWith('127.0.0.1') || host.startsWith('0.0.0.0')) &&
            (oUrl.host.endsWith('.run.app') || oUrl.host.endsWith('.aistudio.google.com') || oUrl.hostname === 'localhost' || oUrl.hostname === '127.0.0.1')) {
          host = oUrl.host;
          proto = oUrl.protocol.replace(':', '');
        }
      } catch {}
    }
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

    if (req.method !== 'GET' && req.method !== 'HEAD' && (req.url.startsWith('/api/reports') || req.url.startsWith('/api/users')) && webRes.status < 400) {
      persistSeedBackup(db);
    }

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

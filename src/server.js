const http = require('http');
const fs = require('fs');
const path = require('path');
const {runAllChecks} = require('./checkApi');

function readRequestBody(req, limitBytes = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks = [];
    req.on('data', (c) => {
      bytes += c.length;
      if (bytes > limitBytes) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendFile(res, absPath, type) {
  if (!fs.existsSync(absPath)) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Not found');
    return;
  }
  res.setHeader('Content-Type', type);
  fs.createReadStream(absPath).pipe(res);
}

function startServer({
  port = 3000,
  base = null,
  concurrency = 8,
  timeoutMs = 8000,
}) {
  const publicDir = path.resolve(__dirname, '../public');
  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (
      req.method === 'GET' &&
      (req.url === '/' || req.url === '/index.html')
    ) {
      return sendFile(
        res,
        path.join(publicDir, 'index.html'),
        'text/html; charset=utf-8',
      );
    }
    if (req.method === 'GET' && req.url === '/app.js') {
      return sendFile(
        res,
        path.join(publicDir, 'app.js'),
        'application/javascript; charset=utf-8',
      );
    }
    if (req.method === 'GET' && req.url === '/favicon.ico') {
      const fav = path.join(publicDir, 'favicon.ico');
      if (fs.existsSync(fav)) return sendFile(res, fav, 'image/x-icon');
      res.statusCode = 204;
      res.end();
      return;
    }

    if (req.method === 'POST' && req.url === '/api/check') {
      try {
        const raw = await readRequestBody(req);
        const type = req.headers['content-type'] || '';
        let payload;
        if (type.startsWith('application/json')) {
          payload = JSON.parse(raw.toString('utf8'));
        } else if (type.startsWith('text/plain')) {
          payload = {html: raw.toString('utf8')};
        } else {
          res.statusCode = 415;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({error: 'Unsupported Content-Type'}));
          return;
        }
        const result = await runAllChecks(payload, {
          base,
          concurrency,
          timeoutMs,
        });
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(result));
      } catch (e) {
        console.error(
          'API /api/check error:',
          (e && (e.stack || e.message)) || e,
        );
        const status = e?.statusCode || 500;
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            error: e?.message || String(e) || 'Internal Server Error',
          }),
        );
      }
      return;
    }

    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Not found');
  });

  server.listen(port, () => {
    console.log(`Server listening on http://localhost:${port}`);
  });
}

module.exports = {startServer};

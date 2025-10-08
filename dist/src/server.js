const http = require('http');
const fs = require('fs');
const path = require('path');
const {checkHtmlLinks} = require('./checker');
const {checkResponsiveHtml} = require('./responsive');
const {runContentChecks} = require('./contentChecks');
const {analyzeEmailWithAI} = require('./ai');
const {buildReport} = require('./report');
const {checkDomainDns} = require('./dnsChecks');
const {analyzeAccessibility} = require('./accessibility');
const {analyzeRtl} = require('./rtl');
const {analyzeJinja} = require('./jinja');

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
        const {html, includeRelative, responsive, content, ai} = payload || {};
        if (!html || typeof html !== 'string') {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({error: 'Missing html'}));
          return;
        }
        const data = await checkHtmlLinks(html, {
          base: payload.base || base || null,
          includeRelative: !!includeRelative,
          timeoutMs: Number(payload.timeoutMs) || timeoutMs,
          concurrency: Number(payload.concurrency) || concurrency,
        });
        let resp = null;
        if (responsive) {
          try {
            resp = await checkResponsiveHtml(html, {});
          } catch (e) {
            resp = {
              supported: false,
              error:
                (e && (e.message || String(e))) || 'responsive check failed',
            };
          }
        }
        let contentOut = null;
        if (content) {
          try {
            contentOut = runContentChecks(html);
          } catch (e) {
            contentOut = {
              error: (e && (e.message || String(e))) || 'content checks failed',
            };
          }
        }
        let aiOut = null;
        if (ai) {
          const r = await analyzeEmailWithAI(html);
          aiOut = r;
        }

        let dnsOut = null;
        try {
          dnsOut = await checkDomainDns(payload.domain, payload.dkimSelectors);
        } catch (e) {
          dnsOut = {
            domain: payload.domain || '',
            error: e?.message || String(e) || 'dns check failed',
          };
        }

        let accessibilityOut = null;
        try {
          accessibilityOut = analyzeAccessibility(html);
        } catch (e) {
          accessibilityOut = {
            error: e?.message || String(e) || 'accessibility check failed',
          };
        }

        let rtlOut = null;
        try {
          rtlOut = analyzeRtl(html);
        } catch (e) {
          rtlOut = {
            error: e?.message || String(e) || 'rtl check failed',
          };
        }

        let jinjaOut = null;
        try {
          jinjaOut = analyzeJinja(html);
        } catch (e) {
          jinjaOut = {
            error: e?.message || String(e) || 'jinja check failed',
          };
        }

        // MVP report
        const report = buildReport({
          campaign: payload.campaign,
          html,
          subject: payload.subject,
          preheader: payload.preheader,
          senderName: payload.senderName,
          replyTo: payload.replyTo,
          domain: payload.domain,
          dns: dnsOut,
          accessibility: accessibilityOut,
          rtl: rtlOut,
          jinja: jinjaOut,
        });

        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            links: data,
            responsive: resp,
            content: contentOut,
            ai: aiOut,
            dns: dnsOut,
            accessibility: accessibilityOut,
            rtl: rtlOut,
            jinja: jinjaOut,
            report,
          }),
        );
      } catch (e) {
        console.error(
          'API /api/check error:',
          (e && (e.stack || e.message)) || e,
        );
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({error: e?.message || String(e)}));
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

'use strict';

const {runAllChecks} = require('../src/checkApi');

const MAX_BODY_BYTES = 2 * 1024 * 1024;

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function parsePayload(req) {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }
  if (req.body && typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch (_) {
      return {html: req.body};
    }
  }

  const raw = await readRequestBody(req);
  const type = req.headers['content-type'] || '';
  if (type.startsWith('application/json')) {
    return JSON.parse(raw.toString('utf8'));
  }
  if (type.startsWith('text/plain')) {
    return {html: raw.toString('utf8')};
  }
  const err = new Error('Unsupported Content-Type');
  err.statusCode = 415;
  throw err;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'POST,OPTIONS');
    res.end('Method Not Allowed');
    return;
  }

  try {
    const payload = await parsePayload(req);
    const result = await runAllChecks(payload, {});
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(result));
  } catch (err) {
    console.error('Vercel api/check error:', err?.stack || err?.message || err);
    const status = err?.statusCode || 500;
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        error: err?.message || String(err) || 'Internal Server Error',
      }),
    );
  }
};

module.exports.config = {
  runtime: 'nodejs20.x',
};

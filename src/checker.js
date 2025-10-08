const http = require('http');
const https = require('https');
const {URL} = require('url');

function isProbablyUrl(value) {
  if (!value) return false;
  const trimmed = String(value).trim();
  if (!trimmed) return false;
  if (/^https?:\/\//i.test(trimmed)) return true;
  if (/^\/\//.test(trimmed)) return true;
  return false;
}

function toAbsoluteUrl(value, base) {
  if (!value) return null;
  let v = String(value).trim();
  if (!v) return null;
  if (/^\/\//.test(v)) {
    v = 'https:' + v;
  }
  if (/^https?:\/\//i.test(v)) {
    return v;
  }
  if (base) {
    try {
      return new URL(v, base).toString();
    } catch (e) {
      return null;
    }
  }
  return null;
}

function extractUrlsFromSrcset(srcset) {
  return String(srcset)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.split(/\s+/)[0])
    .filter(Boolean);
}

function extractLinks(html) {
  const results = [];
  const push = (tag, attr, url) => {
    if (!url) return;
    results.push({tag, attr, url});
  };
  function extractAttr(tag, attr) {
    const regex = new RegExp(
      `<${tag}[^>]*?${attr}\\s*=\\s*(\"[^\"]*\"|'[^']*')`,
      'ig',
    );
    let m;
    while ((m = regex.exec(html)) !== null) {
      const quoted = m[1];
      const value = quoted.slice(1, -1);
      push(tag, attr, value);
    }
  }
  function extractAttrUnquoted(tag, attr) {
    const regex = new RegExp(`<${tag}[^>]*?${attr}\\s*=\\s*([^\"'\s>]+)`, 'ig');
    let m;
    while ((m = regex.exec(html)) !== null) {
      push(tag, attr, m[1]);
    }
  }

  extractAttr('a', 'href');
  extractAttrUnquoted('a', 'href');
  extractAttr('link', 'href');
  extractAttrUnquoted('link', 'href');
  ['img', 'script', 'iframe', 'source', 'audio', 'video'].forEach((t) => {
    extractAttr(t, 'src');
    extractAttrUnquoted(t, 'src');
  });
  extractAttr('video', 'poster');
  extractAttrUnquoted('video', 'poster');
  ['img', 'source'].forEach((t) => {
    const regex = new RegExp(
      `<${t}[^>]*?srcset\\s*=\\s*(\"[^\"]*\"|'[^']*')`,
      'ig',
    );
    let m;
    while ((m = regex.exec(html)) !== null) {
      const quoted = m[1];
      const value = quoted.slice(1, -1);
      extractUrlsFromSrcset(value).forEach((u) => push(t, 'srcset', u));
    }
    const regex2 = new RegExp(`<${t}[^>]*?srcset\\s*=\\s*([^\"'\s>]+)`, 'ig');
    while ((m = regex2.exec(html)) !== null) {
      extractUrlsFromSrcset(m[1]).forEach((u) => push(t, 'srcset', u));
    }
  });

  return results;
}

function requestWithTimeout(options, method, timeoutMs) {
  return new Promise((resolve) => {
    const isHttps =
      options.protocol === 'https:' ||
      options.port === 443 ||
      options.href?.startsWith('https:');
    const lib = isHttps ? https : http;
    const req = lib.request({...options, method}, (res) => {
      res.resume();
      resolve({
        ok: res.statusCode >= 200 && res.statusCode < 400,
        status: res.statusCode,
        headers: res.headers,
      });
    });
    req.on('error', (err) => {
      resolve({ok: false, error: err.message});
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('Request timeout'));
    });
    req.end();
  });
}

async function validateHttpUrl(targetUrl, timeoutMs) {
  let urlObj;
  try {
    urlObj = new URL(targetUrl);
  } catch (e) {
    return {url: targetUrl, ok: false, error: 'Invalid URL'};
  }
  const options = {
    protocol: urlObj.protocol,
    hostname: urlObj.hostname,
    port: urlObj.port
      ? Number(urlObj.port)
      : urlObj.protocol === 'https:'
      ? 443
      : 80,
    path: `${urlObj.pathname || '/'}${urlObj.search || ''}`,
    headers: {'User-Agent': 'ai-mail-checker/1.0'},
  };
  let res = await requestWithTimeout(options, 'HEAD', timeoutMs);
  if (
    !res.ok &&
    (res.status === 405 || res.status === 501 || res.status === 403)
  ) {
    res = await requestWithTimeout(options, 'GET', timeoutMs);
  }
  return {url: targetUrl, ok: !!res.ok, status: res.status, error: res.error};
}

async function runPool(items, worker, concurrency) {
  const results = new Array(items.length);
  let index = 0;
  const workers = Array.from(
    {length: Math.max(1, concurrency | 0)},
    async () => {
      while (true) {
        const i = index++;
        if (i >= items.length) return;
        try {
          results[i] = await worker(items[i], i);
        } catch (e) {
          results[i] = {error: e?.message || String(e)};
        }
      }
    },
  );
  await Promise.all(workers);
  return results;
}

async function checkHtmlLinks(html, options) {
  const {base, includeRelative, concurrency, timeoutMs} = options;
  const rawLinks = extractLinks(html);
  const unique = new Map();
  rawLinks.forEach((l) => {
    const key = `${l.tag}|${l.attr}|${l.url}`;
    if (!unique.has(key)) unique.set(key, l);
  });
  const links = Array.from(unique.values()).filter(
    // Only check anchor hrefs in the links workflow
    (l) => l.tag === 'a' && l.attr === 'href',
  );

  const toCheck = [];
  const skipped = [];
  for (const l of links) {
    let absolute = toAbsoluteUrl(l.url, base);
    const isAbsolute = isProbablyUrl(l.url) || /^https?:/i.test(absolute || '');
    if (!isAbsolute && !includeRelative) {
      skipped.push({...l, reason: 'relative-url'});
      continue;
    }
    if (!absolute) {
      absolute = l.url;
    }
    if (!/^https?:\/\//i.test(absolute)) {
      skipped.push({...l, reason: 'non-http(s)'});
      continue;
    }
    toCheck.push({...l, absolute});
  }

  const results = await runPool(
    toCheck,
    async (item) => {
      const res = await validateHttpUrl(item.absolute, timeoutMs);
      return {...item, ok: res.ok, status: res.status, error: res.error};
    },
    concurrency,
  );

  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  return {ok, failed, skipped, checkedCount: results.length};
}

module.exports = {
  checkHtmlLinks,
  extractLinks,
};

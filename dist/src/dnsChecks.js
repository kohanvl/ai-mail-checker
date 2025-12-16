const dns = require('dns').promises;

function normalizeDomain(domain) {
  if (!domain) return '';
  let value = String(domain).trim();

  // Strip "mailto:" and display-name wrappers like "Name <user@example.com>"
  value = value.replace(/^mailto:/i, '');
  const bracketMatch = value.match(/<([^>]+)>/);
  if (bracketMatch) value = bracketMatch[1].trim();

  // If an email address was provided, keep only the domain part
  if (value.includes('@')) {
    const emailMatch = value.match(/@([^@>\s]+)/);
    value = emailMatch ? emailMatch[1] : value.split('@').pop();
  }

  // Remove scheme, path, port and trailing dots
  value = value
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/[?#].*$/, '')
    .replace(/:+\d+$/, '')
    .replace(/\.+$/, '')
    .toLowerCase();

  // Trim everything after a comma/space to avoid passing accidental garbage to DNS
  value = value.split(/[,\s]/)[0];

  return value;
}

function isLikelyHostname(value) {
  return !!value && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/i.test(value);
}

function getRootDomain(value) {
  if (!value) return '';
  const parts = String(value)
    .split('.')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length <= 2) return value;
  return parts.slice(-2).join('.');
}

async function resolveTxtSafe(hostname) {
  try {
    const txt = await dns.resolveTxt(hostname);
    return {records: txt.map((chunks) => chunks.join('')).filter(Boolean)};
  } catch (err) {
    return {error: err && (err.code || err.message) ? err.code || err.message : String(err)};
  }
}

function validateSpf(records) {
  if (!records || !records.length) return {present: false, valid: false};
  const record = records.find((r) => /^v=spf1\s/i.test(r));
  if (!record) return {present: false, valid: false};
  const hasAll = /\s[-~?\+]all/i.test(record);
  return {present: true, valid: /^v=spf1\s/i.test(record) && hasAll, record};
}

function validateDmarc(records) {
  if (!records || !records.length) return {present: false, valid: false};
  const record = records.find((r) => /^v=DMARC1;/i.test(r));
  if (!record) return {present: false, valid: false};
  const hasPolicy = /;\s*p=/i.test(record);
  return {present: true, valid: /^v=DMARC1;/i.test(record) && hasPolicy, record};
}

function validateDkim(records) {
  if (!records || !records.length) return {present: false, valid: false};
  const record = records.find((r) => /^v=DKIM1;/i.test(r));
  if (!record) return {present: false, valid: false};
  const hasPublicKey = /;\s*p=/i.test(record);
  return {present: true, valid: /^v=DKIM1;/i.test(record) && hasPublicKey, record};
}

async function checkDomainDns(domain, selectors = ['default']) {
  const normalized = normalizeDomain(domain);
  if (!normalized) {
    return {
      domain: '',
      error: 'missing-domain',
      spf: {present: false, valid: false},
      dmarc: {present: false, valid: false},
      dkim: [],
    };
  }

  if (!isLikelyHostname(normalized)) {
    return {
      domain: normalized,
      error: 'invalid-domain',
      spf: {hostname: normalized, present: false, valid: false},
      dmarc: {hostname: `_dmarc.${normalized}`, present: false, valid: false},
      dkim: [],
    };
  }

  const uniqueSelectors = Array.from(
    new Set(
      (Array.isArray(selectors) ? selectors : String(selectors || '').split(',')).map((s) =>
        String(s || '').trim(),
      ),
    ),
  ).filter(Boolean);

  const selectorList = uniqueSelectors.length ? uniqueSelectors : ['default'];

  const rootDomain = getRootDomain(normalized);
  const [spfPrimary, dmarcResult, dkimResults] = await Promise.all([
    resolveTxtSafe(normalized),
    resolveTxtSafe(`_dmarc.${normalized}`),
    Promise.all(
      selectorList.map(async (sel) => {
        const host = `${sel}._domainkey.${normalized}`;
        const res = await resolveTxtSafe(host);
        const validation = validateDkim(res.records);
        return {
          selector: sel,
          hostname: host,
          ...res,
          ...validation,
        };
      }),
    ),
  ]);

  let spfResult = spfPrimary;
  let spfHost = normalized;
  let spfValidation = validateSpf(spfResult.records);

  // If SPF is missing on the subdomain, try the root/apex domain as a fallback
  if (!spfValidation.present && rootDomain && rootDomain !== normalized) {
    const rootSpf = await resolveTxtSafe(rootDomain);
    const rootValidation = validateSpf(rootSpf.records);
    if (rootValidation.present) {
      spfResult = rootSpf;
      spfHost = rootDomain;
      spfValidation = rootValidation;
    }
  }

  const dmarcValidation = validateDmarc(dmarcResult.records);

  return {
    domain: normalized,
    spf: {
      hostname: spfHost,
      ...spfResult,
      ...spfValidation,
    },
    dmarc: {
      hostname: `_dmarc.${normalized}`,
      ...dmarcResult,
      ...dmarcValidation,
    },
    dkim: dkimResults,
    selectors: selectorList,
  };
}

module.exports = {checkDomainDns};

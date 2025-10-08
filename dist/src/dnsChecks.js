const dns = require('dns').promises;

function normalizeDomain(domain) {
  if (!domain) return '';
  return String(domain).trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/:+\d+$/, '').toLowerCase();
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

  const uniqueSelectors = Array.from(
    new Set(
      (Array.isArray(selectors) ? selectors : String(selectors || '').split(',')).map((s) =>
        String(s || '').trim(),
      ),
    ),
  ).filter(Boolean);

  const selectorList = uniqueSelectors.length ? uniqueSelectors : ['default'];

  const [spfResult, dmarcResult, dkimResults] = await Promise.all([
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

  const spfValidation = validateSpf(spfResult.records);
  const dmarcValidation = validateDmarc(dmarcResult.records);

  return {
    domain: normalized,
    spf: {
      hostname: normalized,
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

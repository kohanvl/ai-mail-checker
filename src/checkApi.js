'use strict';

const {checkHtmlLinks} = require('./checker');
const {checkResponsiveHtml} = require('./responsive');
const {runContentChecks} = require('./contentChecks');
const {analyzeEmailWithAI} = require('./ai');
const {buildReport} = require('./report');
const {checkDomainDns} = require('./dnsChecks');
const {analyzeAccessibility} = require('./accessibility');
const {analyzeRtl} = require('./rtl');
const {analyzeJinja} = require('./jinja');

/**
 * Runs the full suite of checks for the /api/check endpoint.
 * Extracted so both the local HTTP server and serverless handlers can reuse the logic.
 * @param {object} payload Incoming request body.
 * @param {object} options Default values for base/concurrency/timeout.
 * @returns {Promise<object>} The response payload.
 */
async function runAllChecks(
  payload,
  {base = null, concurrency = 8, timeoutMs = 8000} = {},
) {
  const html = payload?.html;
  if (!html || typeof html !== 'string') {
    const error = new Error('Missing html');
    error.statusCode = 400;
    throw error;
  }

  const data = await checkHtmlLinks(html, {
    base: payload.base || base || null,
    includeRelative: !!payload.includeRelative,
    timeoutMs: Number(payload.timeoutMs) || timeoutMs,
    concurrency: Number(payload.concurrency) || concurrency,
  });

  let resp = null;
  if (payload.responsive) {
    try {
      resp = await checkResponsiveHtml(html, {});
    } catch (e) {
      resp = {
        supported: false,
        error: (e && (e.message || String(e))) || 'responsive check failed',
      };
    }
  }

  let contentOut = null;
  if (payload.content) {
    try {
      contentOut = runContentChecks(html);
    } catch (e) {
      contentOut = {
        error: (e && (e.message || String(e))) || 'content checks failed',
      };
    }
  }

  let aiOut = null;
  if (payload.ai) {
    aiOut = await analyzeEmailWithAI(html);
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
    accessibilityOut = analyzeAccessibility(html, {
      format: payload.format,
      preheader: payload.preheader,
    });
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
    content: contentOut,
  });

  return {
    links: data,
    responsive: resp,
    content: contentOut,
    ai: aiOut,
    dns: dnsOut,
    accessibility: accessibilityOut,
    rtl: rtlOut,
    jinja: jinjaOut,
    report,
  };
}

module.exports = {runAllChecks};

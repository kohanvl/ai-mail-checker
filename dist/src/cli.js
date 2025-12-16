#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {checkHtmlLinks} = require('./checker');
const {checkResponsiveHtml} = require('./responsive');
const {runContentChecks} = require('./contentChecks');
const {analyzeEmailWithAI} = require('./ai');
const {checkDomainDns} = require('./dnsChecks');
const {analyzeAccessibility} = require('./accessibility');
const {analyzeRtl} = require('./rtl');
const {analyzeJinja} = require('./jinja');

function printUsage() {
  console.log(
    [
      'Usage: ai-mail-checker [--file <path>] [--base <url>] [--concurrency <n>] [--timeout <ms>] [--include-relative] [--fail-on-relative] [--responsive] [--content] [--ai] [--accessibility] [--rtl] [--jinja] [--domain <example.com>] [--dkim <selectors>]',
      '       ai-mail-checker --serve [--port <n>] [--base <url>]',
    ].join('\n'),
  );
}

function parseArgs(argv) {
  const args = {
    file: null,
    base: null,
    concurrency: 8,
    timeoutMs: 8000,
    includeRelative: false,
    failOnRelative: false,
    serve: false,
    port: 3000,
    responsive: false,
    content: false,
    ai: false,
    accessibility: false,
    rtl: false,
    jinja: false,
    domain: null,
    dkimSelectors: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      args.help = true;
      continue;
    }
    if (a === '--file') {
      args.file = argv[++i];
      continue;
    }
    if (a === '--base') {
      args.base = argv[++i];
      continue;
    }
    if (a === '--concurrency') {
      args.concurrency = Number(argv[++i]);
      continue;
    }
    if (a === '--timeout') {
      args.timeoutMs = Number(argv[++i]);
      continue;
    }
    if (a === '--include-relative') {
      args.includeRelative = true;
      continue;
    }
    if (a === '--fail-on-relative') {
      args.failOnRelative = true;
      continue;
    }
    if (a === '--serve') {
      args.serve = true;
      continue;
    }
    if (a === '--port') {
      args.port = Number(argv[++i]);
      continue;
    }
    if (a === '--responsive') {
      args.responsive = true;
      continue;
    }
    if (a === '--content') {
      args.content = true;
      continue;
    }
    if (a === '--ai') {
      args.ai = true;
      continue;
    }
    if (a === '--accessibility') {
      args.accessibility = true;
      continue;
    }
    if (a === '--rtl') {
      args.rtl = true;
      continue;
    }
    if (a === '--jinja') {
      args.jinja = true;
      continue;
    }
    if (a === '--domain') {
      args.domain = argv[++i];
      continue;
    }
    if (a === '--dkim') {
      args.dkimSelectors = argv[++i];
      continue;
    }
  }
  return args;
}

async function runCli(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    printUsage();
    process.exit(0);
  }
  if (args.serve) {
    require('./server').startServer(args);
    return;
  }

  let html = '';
  if (args.file) {
    const abs = path.isAbsolute(args.file)
      ? args.file
      : path.resolve(process.cwd(), args.file);
    if (!fs.existsSync(abs)) {
      console.error('File not found: ' + abs);
      process.exit(2);
    }
    html = fs.readFileSync(abs, 'utf8');
  } else {
    if (process.stdin.isTTY) {
      printUsage();
      process.exit(1);
    }
    html = fs.readFileSync(0, 'utf8');
  }

  const data = await checkHtmlLinks(html, {
    base: args.base,
    includeRelative: args.includeRelative,
    concurrency: args.concurrency,
    timeoutMs: args.timeoutMs,
  });

  console.log('Checked ' + data.checkedCount + ' link(s).');
  if (data.skipped.length)
    console.log('Skipped ' + data.skipped.length + ' link(s).');
  if (data.ok.length) {
    console.log('OK:');
    data.ok.forEach((r) =>
      console.log(
        '  [' +
          (r.status || 'OK') +
          '] ' +
          r.absolute +
          ' <- <' +
          r.tag +
          ' ' +
          r.attr +
          '>',
      ),
    );
  }
  if (data.failed.length) {
    console.log('Broken:');
    data.failed.forEach((r) =>
      console.log(
        '  ' +
          (r.status ? '[' + r.status + ']' : '') +
          ' ' +
          r.absolute +
          ' <- <' +
          r.tag +
          ' ' +
          r.attr +
          '> ' +
          (r.error ? '(error: ' + r.error + ')' : ''),
      ),
    );
  }
  if (data.skipped.length) {
    console.log('Skipped detail:');
    data.skipped.forEach((r) =>
      console.log(
        '  [' + r.reason + '] ' + r.url + ' <- <' + r.tag + ' ' + r.attr + '>',
      ),
    );
  }

  if (args.domain) {
    console.log('\nDNS checks:');
    const dns = await checkDomainDns(args.domain, args.dkimSelectors);
    if (dns.error === 'missing-domain') {
      console.log('  Provide a valid sender domain to run DNS checks.');
    } else if (dns.error) {
      console.log('  Lookup failed: ' + dns.error);
    } else {
      const spfStatus = dns.spf?.valid
        ? 'OK'
        : dns.spf?.present
        ? 'Needs attention'
        : 'Missing';
      console.log(
        '  SPF (' + dns.spf?.hostname + '): ' +
          spfStatus +
          (dns.spf?.record
            ? ' -> ' + dns.spf?.record
            : dns.spf?.error
            ? ' (' + dns.spf?.error + ')'
            : ''),
      );
      const dmarcStatus = dns.dmarc?.valid
        ? 'OK'
        : dns.dmarc?.present
        ? 'Needs attention'
        : 'Missing';
      console.log(
        '  DMARC (' + dns.dmarc?.hostname + '): ' +
          dmarcStatus +
          (dns.dmarc?.record
            ? ' -> ' + dns.dmarc?.record
            : dns.dmarc?.error
            ? ' (' + dns.dmarc?.error + ')'
            : ''),
      );
      const dkim = Array.isArray(dns.dkim) ? dns.dkim : [];
      if (dkim.length) {
        dkim.forEach((entry) => {
          const status = entry.valid
            ? 'OK'
            : entry.present
            ? 'Needs attention'
            : 'Missing';
          console.log(
            '  DKIM selector ' +
              entry.selector +
              ' (' +
              entry.hostname +
              '): ' +
              status +
              (entry.record
                ? ' -> ' + entry.record
                : entry.error
                ? ' (' + entry.error + ')'
                : ''),
          );
        });
      } else {
        console.log('  DKIM: No selectors checked');
      }
    }
  }

  if (args.accessibility) {
    console.log('\nAccessibility:');
    try {
      const acc = analyzeAccessibility(html);
      if (acc.error) {
        console.log('  Check failed: ' + acc.error);
      } else {
        if (Array.isArray(acc.summary) && acc.summary.length)
          acc.summary.forEach((line) => console.log('  ' + line));
        if (Array.isArray(acc.warnings) && acc.warnings.length) {
          console.log('  Issues:');
          acc.warnings.forEach((w) => {
            const parts = [w.type];
            if (w.count != null) parts.push('count=' + w.count);
            if (w.roles) parts.push('roles=' + w.roles.join(','));
            if (w.recommendation)
              parts.push('hint=' + w.recommendation);
            if (w.error) parts.push('error=' + w.error);
            console.log('    - ' + parts.join(' | '));
          });
        } else {
          console.log('  No major accessibility issues detected.');
        }
        const metrics = acc.metrics || {};
        console.log('  Landmark checks (header/footer/main/nav) are skipped.');
        console.log(
          '  Interactive without role=' +
            (metrics.interactiveWithoutRole || 0) +
            ', links without label=' +
            (metrics.anchorsWithoutLabel || 0) +
            ', buttons without label=' +
            (metrics.buttonsWithoutLabel || 0),
        );
      }
    } catch (err) {
      console.log('  Accessibility check error: ' + (err && err.message ? err.message : String(err)));
    }
  }

  if (args.rtl) {
    console.log('\nRTL analysis:');
    try {
      const rtl = analyzeRtl(html);
      if (rtl.error) {
        console.log('  Check failed: ' + rtl.error);
      } else {
        if (Array.isArray(rtl.summary) && rtl.summary.length)
          rtl.summary.forEach((line) => console.log('  ' + line));
        if (Array.isArray(rtl.warnings) && rtl.warnings.length) {
          console.log('  Issues:');
          rtl.warnings.forEach((w) => {
            const parts = [w.type];
            if (w.rtlShare != null) parts.push('rtl%=' + w.rtlShare);
            if (w.recommendation) parts.push('hint=' + w.recommendation);
            if (w.error) parts.push('error=' + w.error);
            console.log('    - ' + parts.join(' | '));
          });
        } else {
          console.log('  No RTL layout issues detected.');
        }
        const metrics = rtl.metrics || {};
        console.log(
          '  RTL share=' +
            (metrics.rtlShare ?? 0) +
            '%, dirRtl=' +
            (metrics.hasDirRtl ? 'yes' : 'no') +
            ', dirLtr=' +
            (metrics.hasDirLtr ? 'yes' : 'no') +
            ', cssDirection=' +
            (metrics.hasDirectionCss ? 'yes' : 'no') +
            ', langRtl=' +
            (metrics.hasLangRtl ? 'yes' : 'no'),
        );
      }
    } catch (err) {
      console.log('  RTL check error: ' + (err && err.message ? err.message : String(err)));
    }
  }

  if (args.jinja) {
    console.log('\nJinja analysis:');
    try {
      const jinja = analyzeJinja(html);
      if (jinja.error) {
        console.log('  Check failed: ' + jinja.error);
      } else {
        if (Array.isArray(jinja.summary) && jinja.summary.length)
          jinja.summary.forEach((line) => console.log('  ' + line));
        if (Array.isArray(jinja.warnings) && jinja.warnings.length) {
          console.log('  Issues:');
          jinja.warnings.forEach((w) => {
            const parts = [w.type];
            if (w.position != null) parts.push('pos=' + w.position);
            if (w.expression) parts.push('expr=' + w.expression);
            if (w.openBlocks) parts.push('openBlocks=' + w.openBlocks.join(','));
            if (w.recommendation) parts.push('hint=' + w.recommendation);
            console.log('    - ' + parts.join(' | '));
          });
        } else {
          console.log('  No Jinja template issues detected.');
        }
        const m = jinja.metrics || {};
        console.log(
          '  Expressions=' +
            (m.totalExpressions || 0) +
            ', statements=' +
            (m.totalStatements || 0) +
            ', comments=' +
            (m.totalComments || 0) +
            ', unclosed blocks=' +
            (m.openBlocks || 0),
        );
      }
    } catch (err) {
      console.log('  Jinja check error: ' + (err && err.message ? err.message : String(err)));
    }
  }

  if (args.responsive) {
    console.log('\nResponsive check:');
    const resp = await checkResponsiveHtml(html, {});
    if (!resp.supported) {
      console.log('  ' + resp.error);
    } else {
      console.log(
        '  meta viewport: ' +
          (resp.metaViewportPresent ? 'present' : 'missing'),
      );
      const viewports = Array.isArray(resp.viewports) ? resp.viewports : [];
      const problematic = Array.isArray(resp.problematic)
        ? resp.problematic
        : viewports.filter((v) => v.problematic);
      if (!problematic.length) {
        console.log(
          '  No problematic devices detected. Baseline: ' +
            ((resp.baseline && resp.baseline.width) || 'n/a') +
            'px',
        );
      } else {
        console.log(
          '  Problematic devices: ' + problematic.length + '/' + viewports.length,
        );
        problematic.forEach((v) => {
          const reasons = Array.isArray(v.reasons)
            ? v.reasons
                .map((r) => r.type + (r.severity ? ' (' + r.severity + ')' : ''))
                .join(', ')
            : '';
          console.log(
            '    width ' +
              v.width +
              ': overflow=' +
              (v.overflowPercent || 0) +
              '%, tooWide=' +
              (Array.isArray(v.tooWide) ? v.tooWide.length : 0) +
              ', smallText=' +
              (Array.isArray(v.smallText) ? v.smallText.length : 0) +
              (reasons ? ' | ' + reasons : ''),
          );
        });
      }
    }
  }

  if (args.content) {
    console.log('\nContent checks:');
    const c = runContentChecks(html);
    if (c.summary.length) {
      console.log('  Summary: ' + c.summary.join('; '));
    }
    console.log(
      '  Text chars: ' +
        c.textChars +
        ', sentences=' +
        c.clarity.sentences +
        ', avg sentence len=' +
        c.clarity.avgSentenceLen,
    );
    console.log(
      '  Mixed language RU/EN: ru=' + c.language.ru + ', en=' + c.language.en,
    );
    console.log(
      '  HTML quality: img without alt=' +
        c.htmlQuality.imgNoAlt +
        ', empty links=' +
        c.htmlQuality.emptyLinks,
    );
    if (c.imageToTextRatio)
      console.log(
        '  Image/text ratio: ' +
          c.imageToTextRatio.ratioImages +
          '% images (images=' +
          c.imageToTextRatio.imgCount +
          ', text chars=' +
          c.imageToTextRatio.textLen +
          ')',
      );
  }

  if (args.ai) {
    console.log('\nAI analysis:');
    const out = await analyzeEmailWithAI(html);
    if (!out.supported) {
      console.log('  ' + out.error);
    } else {
      const r = out.result || {};
      const summaryLine = String(r.summary || '').split('\n')[0];
      if (summaryLine) console.log('  Summary: ' + summaryLine);
      if (r.report) {
        console.log('\n' + r.report + '\n');
      } else {
        if (Array.isArray(r.issues) && r.issues.length)
          console.log('  Issues: ' + r.issues.join('; '));
        if (Array.isArray(r.suggestions) && r.suggestions.length)
          console.log('  Suggestions: ' + r.suggestions.join('; '));
      }
    }
  }

  let exitCode = data.failed.length > 0 ? 1 : 0;
  if (
    args.failOnRelative &&
    data.skipped.some((s) => s.reason === 'relative-url')
  )
    exitCode = 1;
  process.exit(exitCode);
}

if (require.main === module) {
  runCli(process.argv).catch((err) => {
    console.error((err && (err.stack || err.message)) || String(err));
    process.exit(1);
  });
}

module.exports = {runCli};

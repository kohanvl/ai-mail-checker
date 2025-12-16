const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const path = require('path');

function isServerless() {
  return (
    !!process.env.VERCEL ||
    !!process.env.AWS_REGION ||
    process.env.NOW_REGION !== undefined
  );
}

async function resolveBrowserLaunchOptions() {
  if (isServerless()) {
    return {
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless !== undefined ? chromium.headless : true,
      defaultViewport: chromium.defaultViewport || {width: 1200, height: 800},
    };
  }

  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return {
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
      headless: true,
    };
  }

  try {
    // eslint-disable-next-line import/no-extraneous-dependencies, global-require
    const full = require('puppeteer');
    if (full && typeof full.executablePath === 'function') {
      return {
        executablePath: full.executablePath(),
        headless: true,
      };
    }
  } catch (_) {
    // optional dependency; ignore if not installed
  }

  const guess =
    process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : process.platform === 'linux'
      ? '/usr/bin/google-chrome'
      : path.join(
          process.env['PROGRAMFILES'] || 'C:\\Program Files',
          'Google',
          'Chrome',
          'Application',
          'chrome.exe',
        );

  return {
    executablePath: guess,
    headless: true,
  };
}

async function checkResponsiveHtml(html, opts = {}) {
  if (!puppeteer) {
    return {
      supported: false,
      error:
        'puppeteer-core is not available. Install dependencies before running checks.',
    };
  }

  const viewports =
    Array.isArray(opts.viewports) && opts.viewports.length
      ? opts.viewports
      : [320, 375, 414, 768, 1024];

  let browser;
  try {
    const launchOptions = await resolveBrowserLaunchOptions();
    browser = await puppeteer.launch(launchOptions);
  } catch (err) {
    return {
      supported: false,
      error:
        'Could not launch Chrome/Chromium: ' +
        ((err && (err.message || String(err))) || 'unknown') +
        '\nSet PUPPETEER_EXECUTABLE_PATH to a local Chrome binary when running outside serverless.',
    };
  }

  const page = await browser.newPage();
  const htmlDoc = String(html);
  await page.setContent(htmlDoc, {waitUntil: ['domcontentloaded']});

  const hasViewportMeta = await page.evaluate(
    () => !!document.querySelector('meta[name="viewport"]'),
  );

  const perViewport = [];
  for (const width of viewports) {
    await page.setViewport({width, height: 900, deviceScaleFactor: 1});
    await new Promise((resolve) => setTimeout(resolve, 50));

    const issues = await page.evaluate(() => {
      const winW = window.innerWidth;
      const docScrollW = Math.max(
        document.documentElement.scrollWidth,
        document.body ? document.body.scrollWidth : 0,
      );
      const overflowX = docScrollW > winW + 1;
      const overflowPercent = Math.max(0, Math.round(((docScrollW - winW) / winW) * 1000) / 10);
      const tooWide = [];
      const nodes = Array.from(document.querySelectorAll('body *'));
      nodes.forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (!rect || !isFinite(rect.width)) return;
        if (rect.width - winW > 1) {
          const tag = el.tagName.toLowerCase();
          const cls = (el.getAttribute('class') || '').trim();
          tooWide.push({tag, className: cls, width: Math.round(rect.width)});
        }
      });
      const smallText = [];
      nodes.forEach((el) => {
        const cs = window.getComputedStyle(el);
        if (!cs) return;
        const fs = parseFloat(cs.fontSize || '0');
        if (fs && fs < 12) {
          const tag = el.tagName.toLowerCase();
          const cls = (el.getAttribute('class') || '').trim();
          smallText.push({tag, className: cls, fontSize: fs});
        }
      });
      return {
        overflowX,
        overflowPercent,
        tooWide,
        smallText,
        totalElements: nodes.length,
      };
    });

    const needsScreenshot =
      issues.overflowX ||
      (issues.tooWide && issues.tooWide.length) ||
      (issues.smallText && issues.smallText.length);
    let screenshotBase64 = null;
    if (needsScreenshot) {
      try {
        const buf = await page.screenshot({type: 'png', fullPage: true});
        screenshotBase64 = Buffer.from(buf).toString('base64');
      } catch (_) {
        screenshotBase64 = null;
      }
    }

    perViewport.push({width, ...issues, screenshotBase64});
  }

  await browser.close();

  const baselineWidth = viewports.length ? Math.max(...viewports) : 0;
  const baselineViewport =
    perViewport.find((v) => v.width === baselineWidth) || perViewport[0] || null;

  const enriched = perViewport.map((v) => {
    const overflowPercent = Math.max(0, Number(v.overflowPercent) || 0);
    const tooWideCount = Array.isArray(v.tooWide) ? v.tooWide.length : 0;
    const smallTextCount = Array.isArray(v.smallText) ? v.smallText.length : 0;
    const totalElements = Number(v.totalElements) || 0;
    const elementCountRatio = (count) =>
      totalElements > 0
        ? Math.round((count / totalElements) * 1000) / 10 // 0.1% precision
        : null;

    const reasons = [];
    if (overflowPercent > 0 || v.overflowX) {
      reasons.push({
        type: 'layout_overflow',
        severity: 'critical',
        overflowPercent,
      });
    }
    if (tooWideCount > 0) {
      reasons.push({
        type: 'too_wide_elements',
        severity: tooWideCount > 1 ? 'critical' : 'warning',
        count: tooWideCount,
        ratio: elementCountRatio(tooWideCount),
      });
    }
    if (smallTextCount > 0) {
      reasons.push({
        type: 'small_text',
        severity: smallTextCount > 2 ? 'warning' : 'notice',
        count: smallTextCount,
        ratio: elementCountRatio(smallTextCount),
      });
    }

    const baselineOverflow = Math.max(
      0,
      baselineViewport ? Number(baselineViewport.overflowPercent) || 0 : 0,
    );
    const deviationFromBaseline = Math.max(
      0,
      Math.round((overflowPercent - baselineOverflow) * 10) / 10,
    );
    const hasCritical = reasons.some((r) => r.severity === 'critical');
    const problematic =
      hasCritical || deviationFromBaseline >= 5 || tooWideCount > 0 || smallTextCount > 1;

    return {
      ...v,
      overflowPercent,
      totalElements,
      reasons,
      deviationFromBaseline,
      hasCritical,
      problematic,
    };
  });

  const problematic = enriched.filter((v) => v.problematic);

  return {
    supported: true,
    metaViewportPresent: !!hasViewportMeta,
    baseline: {width: baselineWidth},
    viewports: enriched,
    problematic,
  };
}

module.exports = {checkResponsiveHtml, resolveBrowserLaunchOptions};

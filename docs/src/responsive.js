let puppeteer;
try {
  // Lazy require so CLI can work without puppeteer if not needed
  // eslint-disable-next-line import/no-extraneous-dependencies
  puppeteer = require('puppeteer');
} catch (e) {
  puppeteer = null;
}

const {spawnSync} = require('child_process');

function resolveBrowserLaunchOptions() {
  const opts = {
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    headless: true,
  };
  const envPath =
    process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH;
  if (envPath) {
    opts.executablePath = envPath;
    return opts;
  }
  try {
    if (puppeteer && typeof puppeteer.executablePath === 'function') {
      const p = puppeteer.executablePath();
      if (p) opts.executablePath = p;
    }
  } catch (_) {}
  opts.channel = 'chrome';
  return opts;
}

function tryAutoInstall() {
  if (!process.env.AUTO_INSTALL_PUPPETEER) return false;
  try {
    const r = spawnSync('npx', ['puppeteer', 'browsers', 'install', 'chrome'], {
      stdio: 'ignore',
      timeout: 120000,
    });
    return r.status === 0;
  } catch (_) {
    return false;
  }
}

async function checkResponsiveHtml(html, opts = {}) {
  if (!puppeteer) {
    return {
      supported: false,
      error:
        'Puppeteer is not installed. Run `npm i puppeteer` (then optionally `npx puppeteer browsers install chrome`).',
    };
  }
  const viewports =
    Array.isArray(opts.viewports) && opts.viewports.length
      ? opts.viewports
      : [320, 375, 414, 768, 1024];

  let browser;
  let firstErr = null;
  try {
    browser = await puppeteer.launch(resolveBrowserLaunchOptions());
  } catch (e) {
    firstErr = e;
    if (tryAutoInstall()) {
      try {
        browser = await puppeteer.launch(resolveBrowserLaunchOptions());
      } catch (e2) {
        return {
          supported: false,
          error:
            'Could not launch Chrome/Chromium after auto-install: ' +
            ((e2 && (e2.message || String(e2))) || 'unknown'),
        };
      }
    } else {
      return {
        supported: false,
        error:
          'Could not launch Chrome/Chromium: ' +
          ((firstErr && (firstErr.message || String(firstErr))) || 'unknown') +
          '\nSet AUTO_INSTALL_PUPPETEER=1 to auto-install, or run `npx puppeteer browsers install chrome`, or set PUPPETEER_EXECUTABLE_PATH.',
      };
    }
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
    await new Promise((r) => setTimeout(r, 50));
    const issues = await page.evaluate(() => {
      const winW = window.innerWidth;
      const docScrollW = Math.max(
        document.documentElement.scrollWidth,
        document.body ? document.body.scrollWidth : 0,
      );
      const overflowX = docScrollW > winW + 1;
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
      const textNodes = Array.from(document.querySelectorAll('body *'));
      textNodes.forEach((el) => {
        const cs = window.getComputedStyle(el);
        if (!cs) return;
        const fs = parseFloat(cs.fontSize || '0');
        if (fs && fs < 12) {
          const tag = el.tagName.toLowerCase();
          const cls = (el.getAttribute('class') || '').trim();
          smallText.push({tag, className: cls, fontSize: fs});
        }
      });
      return {overflowX, tooWide, smallText};
    });

    let screenshotBase64 = null;
    if (issues.overflowX || (issues.tooWide && issues.tooWide.length)) {
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

  return {
    supported: true,
    metaViewportPresent: !!hasViewportMeta,
    viewports: perViewport,
  };
}

module.exports = {checkResponsiveHtml};

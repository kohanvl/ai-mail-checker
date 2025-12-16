const $ = (s) => document.querySelector(s);
const fileInput = $('#file');
const htmlArea = $('#html');
const runBtn = $('#run');
const clearBtn = $('#clear');
const domainInput = $('#domain');
const dkimInput = $('#dkimSelectors');

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;');
const formatRecord = (value) => {
  const str = String(value ?? '').trim();
  if (!str) return '';
  return escapeHtml(str.length > 200 ? str.slice(0, 200) + '…' : str);
};

// Tabs
const tabs = Array.from(document.querySelectorAll('.tab'));
const panels = {
  linksTab: $('#linksTab'),
  respTab: $('#respTab'),
  aiTab: $('#aiTab'),
  a11yTab: $('#a11yTab'),
  rtlTab: $('#rtlTab'),
  jinjaTab: $('#jinjaTab'),
  dnsTab: $('#dnsTab'),
  reportTab: $('#reportTab'),
  previewTab: $('#previewTab'),
};
function activateTab(id) {
  tabs.forEach((t) =>
    t.classList.toggle('active', t.getAttribute('data-tab') === id),
  );
  Object.entries(panels).forEach(([k, el]) => {
    el.hidden = k !== id;
  });
}

tabs.forEach((t) =>
  t.addEventListener('click', () => activateTab(t.getAttribute('data-tab'))),
);

// Existing refs
const resWrap = $('#linksTab');
const tbody = $('#tbody');
const summary = $('#summary');
const respWrap = $('#respTab');
const respSummary = $('#respSummary');
const respDetails = $('#respDetails');
const respShots = $('#respShots');
const aiWrap = $('#aiTab');
const aiSummary = $('#aiSummary');
const aiDetails = $('#aiDetails');
const a11yWrap = $('#a11yTab');
const a11ySummary = $('#a11ySummary');
const a11yWarnings = $('#a11yWarnings');
const a11yMetrics = $('#a11yMetrics');
const rtlWrap = $('#rtlTab');
const rtlSummary = $('#rtlSummary');
const rtlWarnings = $('#rtlWarnings');
const rtlMetrics = $('#rtlMetrics');
const jinjaWrap = $('#jinjaTab');
const jinjaSummary = $('#jinjaSummary');
const jinjaWarnings = $('#jinjaWarnings');
const jinjaMetrics = $('#jinjaMetrics');
const dnsWrap = $('#dnsTab');
const dnsSummary = $('#dnsSummary');
const dnsSpf = $('#dnsSpf');
const dnsDmarc = $('#dnsDmarc');
const dnsDkim = $('#dnsDkim');
const reportWrap = $('#reportTab');
const reportHuman =
  typeof document !== 'undefined'
    ? document.querySelector('#reportHuman')
    : null;
const previewFrames = {
  normal: document.getElementById('previewNormal'),
  apple: document.getElementById('previewApple'),
  gmail: document.getElementById('previewGmail'),
  outlook: document.getElementById('previewOutlook'),
};
let lastPreviewHtml = '';

const apiBase = (() => {
  if (typeof window !== 'undefined' && window.API_BASE_URL) {
    return window.API_BASE_URL.replace(/\/$/, '');
  }
  if (typeof location !== 'undefined' && location.protocol === 'file:') {
    return 'http://localhost:3000';
  }
  return '';
})();

const resolveApi = (path) => {
  const suffix = path.startsWith('/') ? path : '/' + path;
  return apiBase ? apiBase + suffix : suffix;
};

// Hero gauge
const heroCard = $('#heroCard');
const gauge = $('#gauge');
const gaugeVal = $('#gaugeVal');
const badgeSummary = $('#badgeSummary');
const heroSummary = $('#heroSummary');

const formatReadinessCopy = (score) => {
  if (!Number.isFinite(score)) return 'Overall readiness — awaiting score';
  if (score >= 90) return `Overall readiness: ${score}% — Stellar work!`;
  if (score >= 70)
    return `Overall readiness: ${score}% — Nearly there, just light polish.`;
  if (score >= 40)
    return `Overall readiness: ${score}% — On the right track, keep going!`;
  return `Overall readiness: ${score}% — Early days, but we'll get there.`;
};

function applyDarkModeMode(doc, mode) {
  const style = doc.createElement('style');
  style.setAttribute('data-ai-mail-checker-dark', mode);
  if (mode === 'apple') {
    style.textContent = `
      :root { color-scheme: dark; }
      html, body { background: #000 !important; color: #d5d9e2 !important; }
      body, table, td, p, span, a, li, div, h1, h2, h3, h4, h5, h6 {
        color: #d5d9e2 !important;
      }
      a { color: #8fb8ff !important; }
      img, picture, video, canvas, svg { filter: none !important; mix-blend-mode: normal !important; }
    `;
  } else if (mode === 'gmail') {
    style.textContent = `
      :root { color-scheme: dark; }
      html, body { background: #121212 !important; color: #e4e6eb !important; }
      body * { color: inherit !important; text-shadow: 0 0 0.65px rgba(0, 0, 0, 0.65); }
      table, td, div { background-color: rgba(18, 18, 18, 0.92) !important; }
      img, picture, video, canvas, svg { filter: none !important; }
    `;
  } else if (mode === 'outlook') {
    style.textContent = `
      :root { color-scheme: dark; }
      html { background: #0b1220 !important; filter: invert(1) hue-rotate(180deg) !important; }
      body { background: transparent !important; }
      img, picture, video, canvas, svg, iframe, object { filter: invert(1) hue-rotate(180deg) !important; }
    `;
  }
  (doc.head || doc.documentElement).appendChild(style);
}

function renderIframePreview(frame, html, {mode = 'normal'} = {}) {
  if (!frame || !frame.contentDocument) return;
  const doc = frame.contentDocument;
  doc.open();
  doc.write(html);
  doc.close();

  if (mode !== 'normal') {
    try {
      applyDarkModeMode(doc, mode);
    } catch (_) {
      // ignore injection errors
    }
  }
}

function renderDarkModePreviews(html) {
  lastPreviewHtml = html;
  renderIframePreview(previewFrames.normal, html, {mode: 'normal'});
  renderIframePreview(previewFrames.apple, html, {mode: 'apple'});
  renderIframePreview(previewFrames.gmail, html, {mode: 'gmail'});
  renderIframePreview(previewFrames.outlook, html, {mode: 'outlook'});
}

function extractAndPrefill(rawHtml) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(String(rawHtml), 'text/html');
    const getMeta = (name) =>
      doc.querySelector('meta[name="' + name + '"]')?.getAttribute('content') ||
      '';

    // Subject candidates
    const subjectCandidates = [
      doc.querySelector('title')?.textContent || '',
      getMeta('subject'),
      getMeta('og:title'),
    ].filter(Boolean);

    // Preheader candidates
    let preheader = getMeta('description') || '';
    if (!preheader) {
      const preEl = doc.querySelector(
        '[data-preheader], #preheader, .preheader, [style*="display:none" i]',
      );
      if (preEl)
        preheader = preEl.textContent.trim().replace(/\s+/g, ' ').slice(0, 160);
    }

    // Sender name (no longer used in UI)

    // Reply-To (no longer used in UI)

    // Campaign from title or meta (no longer used in UI)

    const setIfEmpty = (sel, val) => {
      if (!val) return;
      const el = document.querySelector(sel);
      if (el && !el.value) el.value = val;
    };

    setIfEmpty('#subject', subjectCandidates[0] || '');
    setIfEmpty('#preheader', preheader);
  } catch (_) {
    // ignore extraction errors
  }
}

fileInput.addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  const text = await f.text();
  htmlArea.value = text;
  extractAndPrefill(text);
});

htmlArea.addEventListener('input', (e) => {
  // lightweight debounce
  if (htmlArea.value.length > 50) {
    clearTimeout(htmlArea.__t);
    htmlArea.__t = setTimeout(() => extractAndPrefill(htmlArea.value), 300);
  }
});

clearBtn.addEventListener('click', () => {
  htmlArea.value = '';
  fileInput.value = '';
  if (domainInput) domainInput.value = '';
  if (dkimInput) dkimInput.value = '';
  tbody.innerHTML = '';
  resWrap.hidden = false; // keep links tab visible by default
  summary.textContent = '';
  respSummary.textContent = '';
  respDetails.innerHTML = '';
  respShots.innerHTML = '';
  aiSummary.textContent = '';
  aiDetails.innerHTML = '';
  if (a11ySummary) a11ySummary.textContent = '';
  if (a11yWarnings) a11yWarnings.innerHTML = '';
  if (a11yMetrics) a11yMetrics.innerHTML = '';
  if (rtlSummary) rtlSummary.textContent = '';
  if (rtlWarnings) rtlWarnings.innerHTML = '';
  if (rtlMetrics) rtlMetrics.innerHTML = '';
  if (jinjaSummary) jinjaSummary.textContent = '';
  if (jinjaWarnings) jinjaWarnings.innerHTML = '';
  if (jinjaMetrics) jinjaMetrics.innerHTML = '';
  if (dnsSummary) dnsSummary.textContent = '';
  if (dnsSpf) dnsSpf.innerHTML = '';
  if (dnsDmarc) dnsDmarc.innerHTML = '';
  if (dnsDkim) dnsDkim.innerHTML = '';
  if (reportHuman) reportHuman.innerHTML = '';
  heroCard.hidden = true;
  if (gauge) gauge.style.setProperty('--p', '0%');
  if (gaugeVal) gaugeVal.textContent = '0';
  lastPreviewHtml = '';
  Object.values(previewFrames).forEach((frame) => {
    if (frame && frame.contentDocument) {
      frame.contentDocument.open();
      frame.contentDocument.write('');
      frame.contentDocument.close();
    }
  });
  activateTab('linksTab');
});

runBtn.addEventListener('click', async () => {
  const html = htmlArea.value.trim();
  if (!html) {
    alert('Upload a file or paste HTML');
    return;
  }
  // Ensure we have attempted extraction before sending
  extractAndPrefill(html);

  runBtn.disabled = true;
  runBtn.textContent = 'Checking...';
  tbody.innerHTML = '';
  summary.textContent = '';
  respSummary.textContent = '';
  respDetails.innerHTML = '';
  respShots.innerHTML = '';
  aiSummary.textContent = '';
  aiDetails.innerHTML = '';
  if (a11ySummary) a11ySummary.textContent = '';
  if (a11yWarnings) a11yWarnings.innerHTML = '';
  if (a11yMetrics) a11yMetrics.innerHTML = '';
  if (rtlSummary) rtlSummary.textContent = '';
  if (rtlWarnings) rtlWarnings.innerHTML = '';
  if (rtlMetrics) rtlMetrics.innerHTML = '';
  if (jinjaSummary) jinjaSummary.textContent = '';
  if (jinjaWarnings) jinjaWarnings.innerHTML = '';
  if (jinjaMetrics) jinjaMetrics.innerHTML = '';
  if (dnsSummary) dnsSummary.textContent = '';
  if (dnsSpf) dnsSpf.innerHTML = '';
  if (dnsDmarc) dnsDmarc.innerHTML = '';
  if (dnsDkim) dnsDkim.innerHTML = '';
  heroCard.hidden = true;
  if (gauge) gauge.style.setProperty('--p', '0%');
  if (gaugeVal) gaugeVal.textContent = '0';

  try {
    const payload = {
      html: html,
      base: null,
      includeRelative: document.querySelector('#includeRel').checked,
      timeoutMs: Number(document.querySelector('#timeout').value) || 8000,
      concurrency: Number(document.querySelector('#conc').value) || 8,
      responsive: document.querySelector('#responsive').checked,
      content: false,
      ai: document.querySelector('#aiChk').checked,
      campaign: '',
      subject: (document.querySelector('#subject').value || '').trim(),
      preheader: (document.querySelector('#preheader').value || '').trim(),
      senderName: '',
      replyTo: '',
      domain: (domainInput?.value || '').trim(),
      dkimSelectors: (dkimInput?.value || '').trim(),
    };
    const r = await fetch(resolveApi('/api/check'), {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const err = new Error('HTTP ' + r.status);
      err.status = r.status;
      try {
        err.body = await r.text();
      } catch (_) {
        // ignore body read errors
      }
      throw err;
    }
    const data = await r.json();

    // Links
    const links = data.links;
    const rows = [];
    const addRow = (type, item) => {
      const st = type === 'ok' ? 'ok' : type === 'skip' ? 'skip' : 'bad';
      const icon = type === 'ok' ? '✅' : type === 'skip' ? '⚠️' : '❌';
      const statusText =
        type === 'ok' ? 'OK' : type === 'skip' ? 'SKIP' : 'BROKEN';
      rows.push(
        '<tr>\n' +
          '  <td class="status ' +
          st +
          '">' +
          icon +
          ' ' +
          statusText +
          '</td>\n' +
          '  <td style="word-break:break-all">' +
          String(item.absolute || item.url || '')
            .split('<')
            .join('&lt;') +
          '</td>\n' +
          '  <td>&lt;' +
          item.tag +
          ' ' +
          item.attr +
          '&gt;</td>\n' +
          '  <td>' +
          (item.status || '') +
          '</td>\n' +
          '  <td>' +
          String(item.error || '')
            .split('<')
            .join('&lt;') +
          '</td>\n' +
          '</tr>',
      );
    };
    links.ok.forEach((x) => addRow('ok', x));
    links.failed.forEach((x) => addRow('bad', x));
    links.skipped.forEach((x) => addRow('skip', x));
    tbody.innerHTML = rows.join('');
    summary.textContent =
      'Checked: ' +
      links.checkedCount +
      '. OK: ' +
      links.ok.length +
      '. Broken: ' +
    links.failed.length +
    '. Skipped: ' +
    links.skipped.length +
    '.';

    // Accessibility
    if (a11yWrap) {
      const acc = data.accessibility;
      if (!acc) {
        a11ySummary.textContent = 'Данные доступности не получены.';
        a11yWarnings.innerHTML = '';
        a11yMetrics.innerHTML = '';
      } else if (acc.error) {
        a11ySummary.textContent = 'Accessibility error: ' + acc.error;
        a11yWarnings.innerHTML = '';
        a11yMetrics.innerHTML = '';
      } else {
        const summaryLines = Array.isArray(acc.summary) && acc.summary.length
          ? acc.summary
          : ['Проблемы с доступностью не обнаружены в базовых проверках.'];
        a11ySummary.textContent = summaryLines.join(' ');

        const warningLabels = {
          missing_landmark_main: 'Нет <main> или role="main"',
          missing_landmark_header: 'Нет <header> или role="banner"',
          missing_landmark_footer: 'Нет <footer> или role="contentinfo"',
          missing_landmark_navigation: 'Нет <nav> или role="navigation"',
          interactive_missing_role: 'Кликабельные элементы без role',
          invalid_role: 'Нераспознанные значения role',
          links_without_label: 'Ссылки без текста или aria-label',
          buttons_without_label: 'Кнопки без текста или aria-label',
          role_without_label: 'Элементы с role без aria-label/текста',
          accessibility_failed: 'Ошибка проверки доступности',
        };

        if (Array.isArray(acc.warnings) && acc.warnings.length) {
          const warnList = acc.warnings
            .map((w) => {
              const label = warningLabels[w.type] || w.type;
              const parts = [label];
              if (w.count != null) parts.push('кол-во: ' + w.count);
              if (w.roles) parts.push('role: ' + w.roles.join(', '));
              if (w.recommendation)
                parts.push('совет: ' + w.recommendation);
              if (w.error) parts.push('ошибка: ' + w.error);
              return (
                '<li>' +
                parts
                  .map((p) =>
                    escapeHtml(
                      typeof p === 'string' ? p : JSON.stringify(p),
                    ),
                  )
                  .join(' — ') +
                '</li>'
              );
            })
            .join('');
          a11yWarnings.innerHTML =
            '<ul style="margin:6px 0 0 16px; padding:0; list-style:disc; color:#b45309">' +
            warnList +
            '</ul>';
        } else {
          a11yWarnings.innerHTML =
            '<div style="color:#047857">Проблемы не найдены.</div>';
        }

        const metrics = acc.metrics || {};
        const metricsLines = [
          'Проверка <header>/<footer>/<main>/<nav> отключена',
          'Кликабельных без role: ' + (metrics.interactiveWithoutRole || 0),
          'Ссылок без имени: ' + (metrics.anchorsWithoutLabel || 0),
          'Кнопок без имени: ' + (metrics.buttonsWithoutLabel || 0),
        ];
        a11yMetrics.innerHTML =
          '<div>' +
          metricsLines
            .map((line) => '<div>' + escapeHtml(line) + '</div>')
            .join('') +
          '</div>';
      }
    }

    if (rtlWrap) {
      const rtl = data.rtl;
      if (!rtl) {
        rtlSummary.textContent = 'Данные RTL не получены.';
        rtlWarnings.innerHTML = '';
        rtlMetrics.innerHTML = '';
      } else if (rtl.error) {
        rtlSummary.textContent = 'RTL check error: ' + rtl.error;
        rtlWarnings.innerHTML = '';
        rtlMetrics.innerHTML = '';
      } else {
        const summaryLines = Array.isArray(rtl.summary) && rtl.summary.length
          ? rtl.summary
          : ['RTL контента не обнаружено.'];
        rtlSummary.textContent = summaryLines.join(' ');

        if (Array.isArray(rtl.warnings) && rtl.warnings.length) {
          const warnList = rtl.warnings
            .map((w) => {
              const labelMap = {
                rtl_missing_direction: 'Нет dir="rtl"/direction:rtl',
                rtl_missing_lang: 'Нет lang="ar"/"he" и т.д.',
                rtl_direction_without_content: 'direction:rtl без RTL контента',
                rtl_conflicting_direction: 'dir="ltr" конфликтует с RTL',
                rtl_failed: 'Ошибка проверки RTL',
              };
              const label = labelMap[w.type] || w.type;
              const parts = [label];
              if (w.rtlShare != null) parts.push('RTL: ' + w.rtlShare + '%');
              if (w.recommendation)
                parts.push('Совет: ' + w.recommendation);
              if (w.error) parts.push('Ошибка: ' + w.error);
              return (
                '<li>' +
                parts
                  .map((p) => escapeHtml(p))
                  .join(' — ') +
                '</li>'
              );
            })
            .join('');
          rtlWarnings.innerHTML =
            '<ul style="margin:6px 0 0 16px; padding:0; list-style:disc; color:#b45309">' +
            warnList +
            '</ul>';
        } else {
          rtlWarnings.innerHTML =
            '<div style="color:#047857">Проблемы не найдены.</div>';
        }

        const metrics = rtl.metrics || {};
        const metricsLines = [
          'Интенсивность RTL: ' + (metrics.rtlShare ?? 0) + '%',
          'dir="rtl": ' + (metrics.hasDirRtl ? '✅' : '❌'),
          'dir="ltr": ' + (metrics.hasDirLtr ? '✅' : '❌'),
          'CSS direction:rtl: ' + (metrics.hasDirectionCss ? '✅' : '❌'),
          'lang RTL: ' + (metrics.hasLangRtl ? '✅' : '❌'),
        ];
        rtlMetrics.innerHTML =
          '<div>' +
          metricsLines
            .map((line) => '<div>' + escapeHtml(line) + '</div>')
            .join('') +
          '</div>';
      }
    }

    if (jinjaWrap) {
      const jinja = data.jinja;
      if (!jinja) {
        jinjaSummary.textContent = 'Данные Jinja не получены.';
        jinjaWarnings.innerHTML = '';
        jinjaMetrics.innerHTML = '';
      } else if (jinja.error) {
        jinjaSummary.textContent = 'Jinja check error: ' + jinja.error;
        jinjaWarnings.innerHTML = '';
        jinjaMetrics.innerHTML = '';
      } else {
        const summaryLines = Array.isArray(jinja.summary) && jinja.summary.length
          ? jinja.summary
          : [];
        jinjaSummary.textContent = summaryLines.join(' ');

        if (Array.isArray(jinja.warnings) && jinja.warnings.length) {
          const warnMap = {
            jinja_unclosed_expression: 'Незакрытое {{ выражение',
            jinja_empty_expression: 'Пустое {{ }} выражение',
            jinja_suspicious_expression: 'Подозрительный синтаксис в выражении',
            jinja_unclosed_statement: 'Незакрытая конструкция {% %}',
            jinja_unmatched_end: 'Лишний end-блок',
            jinja_mismatched_end: 'Неверный end-блок',
            jinja_orphan_else: 'else/elif вне блока',
            jinja_unclosed_block: 'Не закрыт блок Jinja',
            jinja_failed: 'Проверка Jinja не выполнена',
          };
          jinjaWarnings.innerHTML =
            '<ul style="margin:6px 0 0 16px; padding:0; list-style:disc; color:#b45309">' +
            jinja.warnings
              .map((w) => {
                const label = warnMap[w.type] || w.type;
                const parts = [label];
                if (w.expression)
                  parts.push('Фрагмент: ' + escapeHtml(String(w.expression)));
                if (w.position != null) parts.push('Позиция: ' + w.position);
                if (Array.isArray(w.openBlocks))
                  parts.push('Открытые блоки: ' + w.openBlocks.join(', '));
                if (w.recommendation)
                  parts.push('Совет: ' + w.recommendation);
                if (w.error) parts.push('Ошибка: ' + w.error);
                return '<li>' + parts.map((p) => escapeHtml(p)).join(' — ') + '</li>';
              })
              .join('') +
            '</ul>';
        } else {
          jinjaWarnings.innerHTML =
            '<div style="color:#047857">Проблемы не найдены.</div>';
        }

        const m = jinja.metrics || {};
        const metricsLines = [
          'Выражений: ' + (m.totalExpressions || 0),
          'Конструкций: ' + (m.totalStatements || 0),
          'Комментариев: ' + (m.totalComments || 0),
          'Незакрытых блоков: ' + (m.openBlocks || 0),
          'Подозрительных выражений: ' + (m.suspiciousExpressions || 0),
        ];
        jinjaMetrics.innerHTML =
          '<div>' +
          metricsLines
            .map((line) => '<div>' + escapeHtml(line) + '</div>')
            .join('') +
          '</div>';
      }
    }

    // DNS / deliverability summary
    if (dnsWrap) {
      const dns = data.dns;
      if (!dns) {
        dnsSummary.textContent = 'Данные DNS не получены.';
        dnsSpf.innerHTML = '';
        dnsDmarc.innerHTML = '';
        dnsDkim.innerHTML = '';
      } else if (dns.error === 'missing-domain') {
        dnsSummary.textContent =
          'Укажите домен (например, example.com), чтобы проверить SPF/DKIM/DMARC.';
        dnsSpf.innerHTML = '';
        dnsDmarc.innerHTML = '';
        dnsDkim.innerHTML = '';
      } else if (dns.error) {
        dnsSummary.textContent = 'Ошибка DNS: ' + dns.error;
        dnsSpf.innerHTML = '';
        dnsDmarc.innerHTML = '';
        dnsDkim.innerHTML = '';
      } else {
        const spf = dns.spf || {};
        const dmarc = dns.dmarc || {};
        const dkim = Array.isArray(dns.dkim) ? dns.dkim : [];
        const spfLabel = spf.valid
          ? '✅ SPF OK'
          : spf.present
          ? '⚠️ SPF требует внимания'
          : '❌ SPF отсутствует';
        const dmarcLabel = dmarc.valid
          ? '✅ DMARC OK'
          : dmarc.present
          ? '⚠️ DMARC требует внимания'
          : '❌ DMARC отсутствует';
        const validDkim = dkim.filter((x) => x.valid).length;
        const dkimLabel = dkim.length
          ? validDkim === dkim.length
            ? '✅ DKIM OK'
            : validDkim > 0
            ? `⚠️ DKIM частично (${validDkim}/${dkim.length})`
            : '❌ DKIM отсутствует'
          : '⚠️ DKIM селекторы не указаны';
        dnsSummary.textContent =
          'Домен ' +
          dns.domain +
          ': ' +
          [spfLabel, dmarcLabel, dkimLabel].join(' · ');

        dnsSpf.innerHTML =
          '<div><strong>Запись:</strong> ' +
          (spf.record
            ? '<code>' + formatRecord(spf.record) + '</code>'
            : spf.present
            ? 'не распознана'
            : 'нет') +
          '</div>' +
          '<div><strong>Хост:</strong> ' +
          escapeHtml(spf.hostname || dns.domain) +
          '</div>' +
          (spf.error
            ? '<div style="color:#b91c1c">Ошибка: ' +
              escapeHtml(spf.error) +
              '</div>'
            : '');

        dnsDmarc.innerHTML =
          '<div><strong>Запись:</strong> ' +
          (dmarc.record
            ? '<code>' + formatRecord(dmarc.record) + '</code>'
            : dmarc.present
            ? 'не распознана'
            : 'нет') +
          '</div>' +
          '<div><strong>Хост:</strong> ' +
          escapeHtml(dmarc.hostname || '_dmarc.' + dns.domain) +
          '</div>' +
          (dmarc.error
            ? '<div style="color:#b91c1c">Ошибка: ' +
              escapeHtml(dmarc.error) +
              '</div>'
            : '');

        if (dkim.length) {
          dnsDkim.innerHTML =
            '<ul style="margin:6px 0 0 16px; padding:0; list-style:disc; color:#334155">' +
            dkim
              .map((entry) => {
                const state = entry.valid
                  ? '✅ OK'
                  : entry.present
                  ? '⚠️ Требует внимания'
                  : '❌ Нет записи';
                return (
                  '<li style="margin-bottom:6px">' +
                  '<div><strong>' +
                  escapeHtml(entry.selector || '') +
                  '</strong> — ' +
                  state +
                  '</div>' +
                  '<div>Хост: <code>' +
                  escapeHtml(entry.hostname || '') +
                  '</code></div>' +
                  (entry.record
                    ? '<div>Запись: <code>' +
                      formatRecord(entry.record) +
                      '</code></div>'
                    : '') +
                  (entry.error
                    ? '<div style="color:#b91c1c">Ошибка: ' +
                      escapeHtml(entry.error) +
                      '</div>'
                    : '') +
                  '</li>'
                );
              })
              .join('') +
            '</ul>';
        } else {
          dnsDkim.innerHTML =
            '<div style="color:#64748b">Селекторы DKIM не указаны — используйте поле ввода.</div>';
        }
      }
    }

    // Responsive
    if (data.responsive) {
      if (!data.responsive.supported) {
        respSummary.textContent = 'Responsive: ' + data.responsive.error;
      } else {
        const viewports = Array.isArray(data.responsive.viewports)
          ? data.responsive.viewports
          : [];
        const problematic = Array.isArray(data.responsive.problematic)
          ? data.responsive.problematic
          : viewports.filter((v) => v.problematic);
        const baselineWidth =
          (data.responsive.baseline && data.responsive.baseline.width) || null;
        const metaText =
          'тег meta viewport ' +
          (data.responsive.metaViewportPresent ? 'найден' : 'не найден');

        if (!problematic.length) {
          respSummary.textContent =
            'Проблемные девайсы не найдены, ' +
            metaText +
            (baselineWidth ? ' (база ' + baselineWidth + 'px)' : '');
          respDetails.innerHTML =
            '<div>Все ' +
            viewports.length +
            ' проверенных разрешения без критичных отклонений.</div>';
          respShots.innerHTML = '';
        } else {
          respSummary.textContent =
            'Проблемные девайсы (' +
            problematic.length +
            '/' +
            viewports.length +
            '): ' +
            problematic
              .map((v) => (v.width ? v.width + 'px' : 'unknown'))
              .join(', ') +
            ' · ' +
            metaText;

          const reasonMap = {
            layout_overflow: 'горизонтальный скролл/выезд контента',
            too_wide_elements: 'элементы шире экрана',
            small_text: 'слишком мелкий текст',
          };

          const detail = problematic
            .map((v) => {
              const reasonText = Array.isArray(v.reasons)
                ? v.reasons
                    .map((r) => reasonMap[r.type] || r.type)
                    .join(', ')
                : '';
              const overflow = v.overflowPercent
                ? Math.round(v.overflowPercent * 10) / 10
                : 0;
              return (
                '<div style="margin-bottom:6px">' +
                '<strong>' +
                (v.width || '?') +
                'px</strong>: ' +
                (reasonText || 'проблема не детализирована') +
                (overflow > 0 ? ' (overflow ~' + overflow + '%)' : '') +
                '</div>'
              );
            })
            .join('');

          respDetails.innerHTML = '<div>' + detail + '</div>';

          const imgs = [];
          problematic.forEach((v) => {
            if (v.screenshotBase64) {
              imgs.push(
                '<figure style="margin:0">' +
                  '<div style="font-size:11px;color:#64748b;margin-bottom:4px">' +
                  (v.width || '?') +
                  'px</div>' +
                  '<img style="max-width:280px;border:1px solid #e5e7eb;border-radius:8px" src="data:image/png;base64,' +
                  v.screenshotBase64 +
                  '" />' +
                  '</figure>',
              );
            }
          });
          respShots.innerHTML =
            imgs.join('') ||
            '<div style="color:#64748b">Нет скриншотов для проблемных девайсов.</div>';
        }
      }
    }

    // AI
    if (data.ai) {
      if (!data.ai.supported) {
        aiSummary.textContent = 'AI: ' + (data.ai.error || 'unavailable');
        aiDetails.innerHTML = '';
      } else {
        const rj = data.ai.result || {};
        const reportText = String(rj.report || '').trim();
        const summaryText = String(rj.summary || '').trim();
        if (reportText) {
          aiSummary.textContent =
            summaryText || 'AI report ready — see details below.';
          aiDetails.innerHTML =
            '<pre style="white-space:pre-wrap; margin:0; font-size:12px; line-height:1.5; color:#334155; background:#f8fafc; padding:10px; border-radius:8px; border:1px solid #e2e8f0">' +
            escapeHtml(reportText) +
            '</pre>';
        } else {
          aiSummary.textContent = summaryText || '';
          const lines = [];
          if (Array.isArray(rj.issues) && rj.issues.length)
            lines.push('Issues: ' + rj.issues.join(' · '));
          if (Array.isArray(rj.suggestions) && rj.suggestions.length)
            lines.push('Suggestions: ' + rj.suggestions.join(' · '));
          aiDetails.innerHTML =
            '<div>' +
            lines.map((x) => '<div>' + x + '</div>').join('') +
            '</div>';
        }
      }
    }

    // Report + score
    if (data.report) {
      const score = Math.max(
        0,
        Math.min(100, Number(data.report.readiness_score || 0)),
      );
      const color =
        score >= 90 ? '#22c55e' : score >= 70 ? '#f59e0b' : '#ef4444';
      if (gauge) {
        gauge.style.background =
          'conic-gradient(' + color + ' var(--p,0%), #e5e7eb 0)';
        gauge.style.setProperty('--p', score + '%');
      }
      if (gaugeVal) gaugeVal.textContent = String(score);
      if (badgeSummary) badgeSummary.textContent = formatReadinessCopy(score);
      if (heroSummary)
        heroSummary.textContent =
          'Errors: ' +
          data.report.errors.length +
          ', Warnings: ' +
          data.report.warnings.length +
          ', Passed: ' +
          data.report.passed.length;
      heroCard.hidden = false;
      if (reportHuman) {
        const r = data.report;
        const esc = (s) =>
          String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
        const prettyType = (t) => {
          const map = {
            missing_unsubscribe: 'Отсутствует ссылка на отписку',
            missing_alt_text: 'Изображения без alt‑текста',
            missing_subject: 'Отсутствует тема письма',
            missing_preheader: 'Отсутствует прехедер',
            encoding_not_utf8: 'Кодировка не UTF‑8',
            subject_length: 'Длина темы вне рекомендуемого диапазона',
            preheader_length: 'Длина прехедера вне рекомендуемого диапазона',
            subject_equals_preheader: 'Тема совпадает с прехедером',
            body_length: 'Объём текста вне рекомендуемого диапазона',
            image_to_text_ratio: 'Высокая доля картинок относительно текста',
            spam_image_ratio: 'Изображений слишком много — риск спама',
            dns_missing_domain: 'Домен для SPF/DKIM/DMARC не указан',
            dns_lookup_failed: 'Ошибка DNS-запроса',
            spf_missing: 'SPF запись не найдена',
            spf_invalid: 'SPF запись некорректна',
            dmarc_missing: 'DMARC запись не найдена',
            dmarc_invalid: 'DMARC запись некорректна',
            dkim_missing: 'DKIM запись не найдена',
            dkim_invalid: 'DKIM запись некорректна',
            missing_landmark_main: 'Нет основного landmark (<main> или role="main")',
            missing_landmark_header: 'Нет <header> или role="banner"',
            missing_landmark_footer: 'Нет <footer> или role="contentinfo"',
            missing_landmark_navigation: 'Нет <nav> или role="navigation"',
            interactive_missing_role: 'Кликабельные элементы без role',
            invalid_role: 'Нераспознанные значения role',
            links_without_label: 'Ссылки без текста или aria-label',
            buttons_without_label: 'Кнопки без текста или aria-label',
            role_without_label: 'Элемент с role без aria-label/текста',
            accessibility_failed: 'Проверка доступности не выполнена',
            rtl_missing_direction: 'RTL: отсутствует dir="rtl" или стиль direction:rtl',
            rtl_missing_lang: 'RTL: отсутствует lang с арабским/еврейским значением',
            rtl_direction_without_content: 'direction:rtl без RTL контента',
            rtl_conflicting_direction: 'dir="ltr" конфликтует с RTL содержимым',
            rtl_failed: 'Проверка RTL не выполнена',
            jinja_unclosed_expression: 'Jinja: незакрытое выражение {{ }}',
            jinja_empty_expression: 'Jinja: пустое выражение',
            jinja_suspicious_expression: 'Jinja: подозрительный синтаксис',
            jinja_unclosed_statement: 'Jinja: незакрытая конструкция {% %}',
            jinja_unmatched_end: 'Jinja: лишний end-блок',
            jinja_mismatched_end: 'Jinja: неверный end-блок',
            jinja_orphan_else: 'Jinja: else/elif вне блока',
            jinja_unclosed_block: 'Jinja: незакрытый блок',
            jinja_failed: 'Проверка Jinja не выполнена',
            missing_utm: 'Отсутствуют UTM‑метки на ссылках',
            meta_viewport_missing: 'Отсутствует meta viewport',
            html_size: 'Большой размер HTML',
            gif_present: 'Найдены GIF‑изображения',
            inline_css_missing: 'Нет inline CSS или блока <style>',
            retina_optimization: 'Изображения не оптимизированы под ретину',
            spam_trigger_words: 'Обнаружены спам‑триггеры в тексте',
            custom_fonts: 'Используются кастомные веб‑шрифты',
            spam_score: 'Эвристическая оценка риска спама',
          };
          return map[t] || t;
        };
        const prettyPassed = (key) => {
          const map = {
            unsubscribe_present: 'Ссылка на отписку — присутствует',
            alt_present: 'Alt‑тексты у изображений — присутствуют',
            charset_utf8: 'Кодировка: UTF‑8',
            meta_viewport: 'Тег meta viewport — присутствует',
            inline_css_present: 'Inline CSS / <style> — найдены',
            html_size_ok: 'Размер HTML в норме',
            utm_present: 'UTM‑метки — присутствуют',
            spf_valid: 'SPF — корректная запись',
            dmarc_valid: 'DMARC — корректная запись',
            landmark_main: 'Landmark main — присутствует',
            landmark_header: 'Landmark header — присутствует',
            landmark_footer: 'Landmark footer — присутствует',
            landmark_navigation: 'Навигационный landmark — присутствует',
            rtl_layout_defined: 'RTL направление задано',
            jinja_balanced: 'Jinja блоки и выражения — корректны',
          };
          if (key.startsWith('dkim:')) {
            const selector = key.slice(5);
            return 'DKIM селектор ' + selector + ' — корректен';
          }
          return map[key] || key;
        };
        const list = (arr, cls, isPassed = false) =>
          arr.length
            ? '<ul style="margin:6px 0 0 16px; padding:0; list-style:disc; color:' +
              cls +
              '">' +
              arr
                .map((it) =>
                  typeof it === 'string'
                    ? '<li>' + esc(isPassed ? prettyPassed(it) : it) + '</li>'
                    : '<li>' +
                      esc(prettyType(it.type)) +
                      (it.count != null
                        ? ' — количество: ' + esc(it.count)
                        : '') +
                      (it.length != null ? ' — длина: ' + esc(it.length) : '') +
                      (it.ratioImages != null
                        ? ' — картинки: ' + esc(it.ratioImages) + '%'
                        : '') +
                      (it.hostname
                        ? ' — хост: ' + esc(it.hostname)
                        : '') +
                      (it.selector
                        ? ' — селектор: ' + esc(it.selector)
                        : '') +
                      (Array.isArray(it.roles) && it.roles.length
                        ? ' — role: ' + esc(it.roles.join(', '))
                        : '') +
                      (it.record
                        ? ' — запись: ' +
                          esc(
                            it.record.length > 160
                              ? it.record.slice(0, 160) + '…'
                              : it.record,
                          )
                        : '') +
                      (it.error
                        ? ' — ошибка: ' + esc(it.error)
                        : '') +
                      (it.bytes != null
                        ? ' — размер: ' + esc(it.bytes) + ' байт'
                        : '') +
                      (it.level ? ' — уровень: ' + esc(it.level) : '') +
                      (it.recommendation
                        ? ' — рекомендация: ' + esc(it.recommendation)
                        : '') +
                      '</li>',
                )
                .join('') +
              '</ul>'
            : '<div style="color:#64748b">Нет</div>';
        const structured = r.structured_summary || {};
        const renderSummary = () => {
          const d = structured.deliverability?.status || '—';
          const c = structured.content?.status || '—';
          const imgs =
            structured.images && structured.images.issues != null
              ? structured.images.issues
              : '—';
          const jinjaIssues =
            structured.jinja && structured.jinja.issues != null
              ? structured.jinja.issues
              : '—';
          const labelIssues = (val) =>
            val === '—' ? '—' : val + ' issues';
          return (
            '<div style="border:1px solid #e2e8f0;border-radius:10px;padding:10px;background:#f8fafc;margin-bottom:10px">' +
            '<div style="font-weight:700;color:#0f172a;margin-bottom:6px">Summary</div>' +
            '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px">' +
            '<div><div style="font-size:11px;color:#64748b">Deliverability</div><div style="font-weight:700;color:#0f172a">' +
            esc(d) +
            '</div></div>' +
            '<div><div style="font-size:11px;color:#64748b">Content</div><div style="font-weight:700;color:#0f172a">' +
            esc(c) +
            '</div></div>' +
            '<div><div style="font-size:11px;color:#64748b">Images</div><div style="font-weight:700;color:#0f172a">' +
            esc(labelIssues(imgs)) +
            '</div></div>' +
            '<div><div style="font-size:11px;color:#64748b">Jinja</div><div style="font-weight:700;color:#0f172a">' +
            esc(labelIssues(jinjaIssues)) +
            '</div></div>' +
            '</div>' +
            '</div>'
          );
        };
        const actions = Array.isArray(r.action_items) ? r.action_items : [];
        const renderActions = () =>
          '<div style="margin:12px 0 8px">' +
          '<div style="font-weight:700;color:#0f172a;margin-bottom:4px">Action items</div>' +
          (actions.length
            ? '<ul style="margin:0;padding-left:18px;line-height:1.5;color:#0f172a">' +
              actions.map((a) => '<li>' + esc(a) + '</li>').join('') +
              '</ul>'
            : '<div style="color:#64748b">Нет явных действий</div>') +
          '</div>';
        reportHuman.innerHTML =
          '<div>' +
          renderSummary() +
          renderActions() +
          '<div style="font-weight:600;color:#111827">Ошибки (' +
          r.errors.length +
          ')</div>' +
          list(r.errors, '#991b1b') +
          '<div style="font-weight:600;color:#111827;margin-top:8px">Предупреждения (' +
          r.warnings.length +
          ')</div>' +
          list(r.warnings, '#92400e') +
          '<div style="font-weight:600;color:#111827;margin-top:8px">Пройдено (' +
          r.passed.length +
          ')</div>' +
          list(r.passed, '#065f46', true) +
          '</div>';
      }
    }

    // Update preview iframes (Normal, Apple Mail, Gmail, Outlook)
    renderDarkModePreviews(html);

    // show first tab by default
    activateTab('linksTab');
  } catch (e) {
    const msg = (e && e.message) || String(e) || 'Unknown error';
    const status = e && e.status;
    let hint = '';
    if (
      typeof location !== 'undefined' &&
      (status === 404 || status === 405)
    ) {
      hint =
        '\n\nAPI /api/check is not running for this build. Start the backend with `npm run serve` (dev) or `npm run preview` after a build, or set window.API_BASE_URL.';
    } else if (
      typeof location !== 'undefined' &&
      location.protocol === 'file:'
    ) {
      hint =
        '\n\nHint: run `npm run serve` and open http://localhost:3000/ (or set window.API_BASE_URL).';
    }
    alert('Error: ' + msg + hint);
  } finally {
    runBtn.disabled = false;
    runBtn.textContent = 'Run check';
  }
});

const {extractLinks} = require('./checker');
const {runContentChecks, imageToTextRatio} = require('./contentChecks');

function nowIso() {
  return new Date().toISOString();
}

function hasUnsubscribe(html, text) {
  const lower = (html + ' ' + text).toLowerCase();
  return /unsubscribe|unsub|{{\s*unsubscribe\s*}}|%unsubscribe%|\*\|UNSUB\|\*/i.test(
    lower,
  );
}

function hasMetaViewport(html) {
  return /<meta[^>]+name=["']viewport["'][^>]*>/i.test(html);
}

function charsetIsUtf8(html) {
  const m = html.match(/<meta[^>]+charset=["']?([^"'>\s]+)/i);
  if (!m) return false;
  return /utf-8/i.test(m[1]);
}

function inlineCssPresent(html) {
  return /style=/i.test(html) || /<style[\s>]/i.test(html);
}

function companyAddressPresent(html) {
  const lower = html.toLowerCase();
  return /\b(address|адрес)\b/.test(lower) || /\d{5,}\s+/.test(lower);
}

function subjectMetrics(subject, preheader) {
  const s = subject || '';
  const p = preheader || '';
  return {
    subjectLength: s.length,
    preheaderLength: p.length,
    duplicate: s && p && s.trim() === p.trim(),
    subjectInRange: s.length >= 30 && s.length <= 50,
    preheaderInRange: p.length >= 30 && p.length <= 50,
  };
}

function utmOnLinks(html) {
  const links = extractLinks(html).filter(
    (l) => l.tag === 'a' && l.attr === 'href',
  );
  const total = links.length;
  const withUtm = links.filter((l) => /[?&]utm_/.test(l.url)).length;
  return {total, withUtm, missing: total - withUtm};
}

function missingAltImages(html) {
  const all = html.match(/<img\b[^>]*>/gi) || [];
  const missing = all.filter((tag) => !/\balt=/.test(tag));
  return {total: all.length, missing: missing.length};
}

function retinaOptimization(html) {
  const imgs = html.match(/<img\b[^>]*>/gi) || [];
  let total = 0;
  let optimized = 0;
  imgs.forEach((tag) => {
    total += 1;
    const srcMatch = tag.match(/\bsrc=["']([^"']+)["']/i);
    const srcsetMatch = tag.match(/\bsrcset=["']([^"']+)["']/i);
    const src = (srcMatch && srcMatch[1]) || '';
    const srcset = (srcsetMatch && srcsetMatch[1]) || '';
    const isSvg = /\.svg(\?|#|$)/i.test(src);
    const has2xInSrc = /(@2x|-2x|_2x)\./i.test(src);
    const has2xInSrcset = /\s+2x(,|\s|$)/i.test(srcset);
    if (isSvg || has2xInSrc || has2xInSrcset) optimized += 1;
  });
  return {total, optimized, unoptimized: Math.max(0, total - optimized)};
}

function htmlSizeOk(html) {
  const bytes = Buffer.byteLength(html, 'utf8');
  return {bytes, ok: bytes < 100 * 1024};
}

function gifSizesHeuristic(html) {
  const gifs = (
    html.match(/<img\b[^>]*src=["'][^"']+\.gif["'][^>]*>/gi) || []
  ).map((t) => t);
  return {gifs: gifs.length};
}

const SPAM_WORDS = [
  'free',
  'winner',
  'congratulations',
  'urgent',
  'act now',
  'guarantee',
  'earn money',
  'risk-free',
  'no credit',
  'credit',
  'deal',
  'cheap',
  '$$$',
  'limited time',
  'apply now',
  'lose weight',
  'miracle',
  'click here',
  'buy now',
  'order now',
  'trial',
  'pills',
  'casino',
  'viagra',
];
function spamTriggers(text) {
  const lower = text.toLowerCase();
  let count = 0;
  const hits = [];
  SPAM_WORDS.forEach((w) => {
    const re = new RegExp(
      '(?:^|\\b)' + w.replace(/[$]/g, '\\$&') + '(?:$|\\b)',
      'i',
    );
    if (re.test(lower)) {
      count += 1;
      hits.push(w);
    }
  });
  const exclamations = (text.match(/!/g) || []).length;
  const allCapsWords = (text.match(/\b[A-Z]{5,}\b/g) || []).length;
  return {count, hits, exclamations, allCapsWords};
}

function customFonts(html) {
  const hasFontFace =
    /@font-face|\.(woff2?|ttf|otf)\b|fonts\.googleapis\.com/i.test(html);
  const families = [];
  const styleBlocks = html.match(/<style[\s\S]*?<\/style>/gi) || [];
  styleBlocks.forEach((blk) => {
    (blk.match(/font-family\s*:\s*([^;}{]+)/gi) || []).forEach((m) => {
      const fam = m.split(':')[1]?.trim();
      if (fam) families.push(fam.replace(/["']/g, ''));
    });
  });
  return {used: hasFontFace || families.length > 0, families};
}

function heuristicSpamScore({text, html}) {
  const trig = spamTriggers(text);
  const ratio = imageToTextRatio(html, text);
  const links = extractLinks(html).filter(
    (l) => l.tag === 'a' && l.attr === 'href',
  ).length;
  const capsPenalty = Math.min(20, trig.allCapsWords * 1.5);
  const exclPenalty = Math.min(15, trig.exclamations * 0.5);
  const triggerPenalty = Math.min(30, trig.count * 4);
  const imgPenalty =
    ratio.ratioImages > 40 ? Math.min(20, (ratio.ratioImages - 40) * 0.5) : 0;
  const linksPenalty = links > 20 ? Math.min(10, (links - 20) * 0.5) : 0;
  const fontPenalty = customFonts(html).used ? 3 : 0;
  const score = Math.round(
    Math.max(
      0,
      Math.min(
        100,
        capsPenalty +
          exclPenalty +
          triggerPenalty +
          imgPenalty +
          linksPenalty +
          fontPenalty,
      ),
    ),
  );
  let level = 'low';
  if (score >= 70) level = 'high';
  else if (score >= 40) level = 'medium';
  return {score, level, trig, ratioImages: ratio.ratioImages, links};
}

const ACTION_MAP = {
  missing_unsubscribe: 'Добавьте рабочую ссылку на отписку в конце письма.',
  missing_alt_text: 'Пропишите alt-тексты для всех изображений.',
  missing_subject: 'Заполните тему письма (30–50 символов).',
  missing_preheader: 'Добавьте прехедер длиной 30–50 символов.',
  encoding_not_utf8: 'Укажите <meta charset="UTF-8"> для корректной кодировки.',
  subject_length: 'Приведите тему к диапазону 30–50 символов.',
  preheader_length: 'Сделайте прехедер длиной 30–50 символов.',
  subject_equals_preheader: 'Сформулируйте прехедер иначе, чем тема.',
  body_length: 'Доведите общий объём текста до 500–2500 символов.',
  image_to_text_ratio: 'Увеличьте долю текста: цель — минимум 60% текста.',
  spam_image_ratio: 'Сократите количество картинок или добавьте текстовый блок.',
  dns_missing_domain: 'Укажите домен отправителя, чтобы проверить SPF/DKIM/DMARC.',
  dns_lookup_failed: 'Проверьте DNS-записи домена и доступность резолва.',
  spf_missing: 'Создайте SPF TXT запись вида v=spf1 ... -all.',
  spf_invalid: 'Исправьте SPF: завершите -all/~all и проверьте синтаксис.',
  dmarc_missing: 'Добавьте _dmarc TXT с политикой p=none/quarantine/reject.',
  dmarc_invalid: 'Исправьте DMARC: укажите v=DMARC1; p=... и нужные теги.',
  dkim_missing: 'Опубликуйте DKIM TXT с публичным ключом для селектора.',
  dkim_invalid: 'Проверьте DKIM запись: v=DKIM1; и параметр p=PUBLIC_KEY.',
  missing_landmark_main: 'Отметьте основной контент тегом <main> или role="main".',
  missing_landmark_header: 'Добавьте <header> или role="banner" для шапки.',
  missing_landmark_footer: 'Добавьте <footer> или role="contentinfo".',
  missing_landmark_navigation: 'Пометьте навигацию через <nav> или role="navigation".',
  interactive_missing_role: 'Для кликабельных div/span задайте role и aria-label.',
  invalid_role: 'Используйте допустимые значения атрибута role.',
  links_without_label: 'Добавьте текст или aria-label для всех ссылок.',
  buttons_without_label: 'Добавьте текст или aria-label для всех кнопок.',
  role_without_label: 'Задайте aria-label/labelledby для элементов с role.',
  accessibility_failed: 'Повторите проверку доступности или исправьте HTML.',
  rtl_missing_direction: 'Добавьте dir="rtl" или CSS direction: rtl для RTL секций.',
  rtl_missing_lang: 'Укажите lang="ar"/"he" на корневом или секционном теге.',
  rtl_direction_without_content: 'Удалите direction:rtl или добавьте RTL контент в эту область.',
  rtl_conflicting_direction: 'Согласуйте dir атрибуты с фактическим RTL контентом.',
  rtl_failed: 'Проверьте разметку RTL вручную и запустите проверку снова.',
  jinja_unclosed_expression: 'Закройте выражение Jinja: добавьте }}.',
  jinja_empty_expression: 'Удалите пустые {{ }} или заполните выражение.',
  jinja_suspicious_expression: 'Проверьте синтаксис выражения Jinja и фильтров.',
  jinja_unclosed_statement: 'Закройте конструкцию Jinja парой %}.',
  jinja_unmatched_end: 'Удалите лишний end-блок или добавьте соответствующий opener.',
  jinja_mismatched_end: 'Исправьте закрывающий тег Jinja: end... должен совпадать.',
  jinja_orphan_else: 'Переместите else/elif внутрь соответствующего блока.',
  jinja_unclosed_block: 'Закройте все открытые блоки Jinja (endblock/endfor/endif).',
  jinja_failed: 'Проверьте шаблон Jinja вручную и повторите проверку.',
  missing_utm: 'Добавьте UTM-метки к ссылкам для отслеживания переходов.',
  meta_viewport_missing:
    'Добавьте <meta name="viewport" content="width=device-width,initial-scale=1">.',
  html_size: 'Сократите размер HTML до <100KB (минификация/удаление лишнего).',
  gif_present: 'Сожмите GIF-файлы до <1MB или замените статикой/видео.',
  inline_css_missing:
    'Перенесите критичные стили inline или в <style> для email-клиентов.',
  retina_optimization: 'Добавьте srcset с 2x/SVG для ретина-экранов.',
  spam_trigger_words: 'Уберите спам-триггеры вроде "free", "guarantee", капслок.',
  spam_score: 'Снизьте спам-риск: уберите триггеры, уменьшите капслок и балансируйте текст.',
  custom_fonts: 'Проверьте загрузку веб-шрифтов или замените на системные для стабильности.',
  email_missing_alt: 'Добавьте alt-тексты в <img> в письме.',
  email_image_weight: 'Сожмите инлайн-изображения до <500KB или вынесите на CDN.',
  email_retina_missing: 'Добавьте srcset 2x или SVG для писем с изображениями.',
  email_inline_css_missing: 'Используйте инлайн-стили для совместимости почтовиков.',
  email_missing_utm: 'Добавьте UTM-метки к email-ссылкам.',
  email_preheader_missing: 'Добавьте прехедер в письмо (видимый текст в начале).',
};

function deliverabilityStatus(errors, warnings) {
  const criticalTypes = new Set([
    'missing_unsubscribe',
    'missing_subject',
    'missing_preheader',
    'encoding_not_utf8',
    'dns_missing_domain',
    'dns_lookup_failed',
    'spf_missing',
    'spf_invalid',
    'dmarc_missing',
    'dmarc_invalid',
    'dkim_missing',
    'dkim_invalid',
  ]);
  const warningTypes = new Set([
    'missing_utm',
    'spam_trigger_words',
    'spam_score',
    'spam_image_ratio',
    'image_to_text_ratio',
    'html_size',
    'gif_present',
    'inline_css_missing',
    'retina_optimization',
    'email_inline_css_missing',
    'email_image_weight',
    'email_missing_utm',
  ]);
  const spam = warnings.find((w) => w.type === 'spam_score');
  const critical =
    errors.some((e) => criticalTypes.has(e.type)) ||
    warnings.some((w) => criticalTypes.has(w.type)) ||
    (spam && spam.level === 'high');
  if (critical) return 'Critical';
  const warn =
    warnings.some((w) => warningTypes.has(w.type)) ||
    (spam && spam.level === 'medium');
  return warn ? 'Warning' : 'OK';
}

function contentStatus({content, errors, warnings}) {
  const contentTypes = new Set([
    'missing_subject',
    'missing_preheader',
    'subject_length',
    'preheader_length',
    'subject_equals_preheader',
    'body_length',
  ]);
  const hasContentIssue =
    errors.some((e) => contentTypes.has(e.type)) ||
    warnings.some((w) => contentTypes.has(w.type));
  const contentSummary = Array.isArray(content?.summary) ? content.summary : [];
  if (content?.error) return 'Needs fixes';
  if (contentSummary.length) return 'Needs fixes';
  if (hasContentIssue) return 'Needs fixes';
  return 'OK';
}

function imageIssueCount({errors, warnings}) {
  const imageTypes = new Set([
    'missing_alt_text',
    'image_to_text_ratio',
    'spam_image_ratio',
    'retina_optimization',
    'gif_present',
    'email_missing_alt',
    'email_image_weight',
    'email_retina_missing',
  ]);
  let count = 0;
  [...errors, ...warnings].forEach((issue) => {
    if (imageTypes.has(issue.type)) count += 1;
  });
  return count;
}

function buildActionItems(errors, warnings, content) {
  const combined = [...errors, ...warnings];
  const items = [];
  combined.forEach((issue) => {
    const action = ACTION_MAP[issue.type] || issue.recommendation;
    if (action && !items.includes(action)) items.push(action);
  });
  if (content?.error) {
    const msg = 'Контентные проверки не выполнены: ' + content.error;
    if (!items.includes(msg)) items.push(msg);
  }
  const contentSummary = Array.isArray(content?.summary) ? content.summary : [];
  contentSummary.forEach((line) => {
    const action = 'Контент: ' + line;
    if (action && !items.includes(action)) items.push(action);
  });
  return items.slice(0, 12);
}

function buildReport({
  campaign,
  html,
  subject,
  preheader,
  senderName,
  replyTo,
  domain,
  dns,
  accessibility,
  rtl,
  jinja,
  content,
}) {
  const text = (html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const errors = [];
  const warnings = [];
  const passed = [];

  // Errors
  if (!hasUnsubscribe(html, text)) errors.push({type: 'missing_unsubscribe'});
  else passed.push('unsubscribe_present');
  const alt = missingAltImages(html);
  if (alt.missing > 0)
    errors.push({type: 'missing_alt_text', count: alt.missing});
  else passed.push('alt_present');
  if (!subject) errors.push({type: 'missing_subject'});
  if (!preheader) errors.push({type: 'missing_preheader'});
  if (!charsetIsUtf8(html)) errors.push({type: 'encoding_not_utf8'});
  else passed.push('charset_utf8');

  // Warnings
  const sm = subjectMetrics(subject, preheader);
  if (!sm.subjectInRange)
    warnings.push({
      type: 'subject_length',
      length: sm.subjectLength,
      recommendation: '30–50 chars',
    });
  if (!sm.preheaderInRange)
    warnings.push({
      type: 'preheader_length',
      length: sm.preheaderLength,
      recommendation: '30–50 chars',
    });
  if (sm.duplicate) warnings.push({type: 'subject_equals_preheader'});

  const bodyLen = text.length;
  if (bodyLen < 500 || bodyLen > 2500)
    warnings.push({
      type: 'body_length',
      length: bodyLen,
      recommendation: '500–2500 chars',
    });

  const ratio = imageToTextRatio(html, text);
  if (ratio.ratioImages > 40)
    warnings.push({
      type: 'image_to_text_ratio',
      ratioImages: ratio.ratioImages,
      recommendation: '≥60% text recommended',
    });

  if (dns) {
    if (dns.error === 'missing-domain') {
      warnings.push({
        type: 'dns_missing_domain',
        recommendation: 'Укажите домен отправителя, чтобы проверить SPF/DKIM/DMARC',
      });
    } else if (dns.error) {
      warnings.push({
        type: 'dns_lookup_failed',
        error: dns.error,
        recommendation: 'Проверьте доступность DNS и корректность домена',
      });
    } else {
      const spf = dns.spf || {};
      if (!spf.present) {
        warnings.push({
          type: 'spf_missing',
          hostname: spf.hostname || dns.domain,
          error: spf.error,
          recommendation: 'Добавьте TXT запись SPF (v=spf1 ... -all)',
        });
      } else if (!spf.valid) {
        warnings.push({
          type: 'spf_invalid',
          hostname: spf.hostname || dns.domain,
          record: spf.record,
          recommendation: 'Проверьте SPF и завершайте запись директивой -all/~all',
        });
      } else {
        passed.push('spf_valid');
      }

      const dmarc = dns.dmarc || {};
      if (!dmarc.present) {
        warnings.push({
          type: 'dmarc_missing',
          hostname: dmarc.hostname,
          error: dmarc.error,
          recommendation: 'Добавьте _dmarc TXT запись (v=DMARC1; p=quarantine/none/reject)',
        });
      } else if (!dmarc.valid) {
        warnings.push({
          type: 'dmarc_invalid',
          hostname: dmarc.hostname,
          record: dmarc.record,
          recommendation: 'Запись должна содержать v=DMARC1 и политику p=',
        });
      } else {
        passed.push('dmarc_valid');
      }

      const dkimItems = Array.isArray(dns.dkim) ? dns.dkim : [];
      dkimItems.forEach((dkim) => {
        if (!dkim.present) {
          warnings.push({
            type: 'dkim_missing',
            selector: dkim.selector,
            hostname: dkim.hostname,
            error: dkim.error,
            recommendation: 'Добавьте DKIM TXT запись с публичным ключом',
          });
        } else if (!dkim.valid) {
          warnings.push({
            type: 'dkim_invalid',
            selector: dkim.selector,
            hostname: dkim.hostname,
            record: dkim.record,
            recommendation: 'Запись должна содержать v=DKIM1; и параметр p=',
          });
        } else {
          passed.push(`dkim:${dkim.selector}`);
        }
      });
    }
  }

  if (accessibility) {
    if (accessibility.error) {
      warnings.push({
        type: 'accessibility_failed',
        error: accessibility.error,
        recommendation: 'Попробуйте снова позже или проверьте HTML вручную',
      });
    } else {
      if (Array.isArray(accessibility.warnings))
        accessibility.warnings.forEach((w) => warnings.push({...w}));
      if (Array.isArray(accessibility.passed))
        accessibility.passed.forEach((p) => passed.push(p));
    }
  }

  if (rtl) {
    if (rtl.error) {
      warnings.push({
        type: 'rtl_failed',
        error: rtl.error,
        recommendation: 'Проверьте поддержку RTL вручную',
      });
    } else {
      if (Array.isArray(rtl.warnings)) rtl.warnings.forEach((w) => warnings.push({...w}));
      if (Array.isArray(rtl.passed)) rtl.passed.forEach((p) => passed.push(p));
    }
  }

  if (jinja) {
    if (jinja.error) {
      warnings.push({
        type: 'jinja_failed',
        error: jinja.error,
        recommendation: 'Проверьте шаблон Jinja вручную',
      });
    } else {
      if (Array.isArray(jinja.warnings))
        jinja.warnings.forEach((w) => warnings.push({...w}));
      if (Array.isArray(jinja.passed)) jinja.passed.forEach((p) => passed.push(p));
    }
  }

  const utm = utmOnLinks(html);
  if (utm.missing > 0)
    warnings.push({type: 'missing_utm', missing: utm.missing});
  else passed.push('utm_present');

  if (!hasMetaViewport(html)) warnings.push({type: 'meta_viewport_missing'});
  else passed.push('meta_viewport');

  const size = htmlSizeOk(html);
  if (!size.ok)
    warnings.push({
      type: 'html_size',
      bytes: size.bytes,
      recommendation: '< 100KB',
    });
  else passed.push('html_size_ok');

  const gifH = gifSizesHeuristic(html);
  if (gifH.gifs > 0)
    warnings.push({
      type: 'gif_present',
      count: gifH.gifs,
      recommendation: 'Compress < 1MB',
    });

  if (!inlineCssPresent(html)) warnings.push({type: 'inline_css_missing'});
  else passed.push('inline_css_present');

  if (companyAddressPresent(html)) passed.push('company_address_present');

  // Retina optimization for images
  const retina = retinaOptimization(html);
  if (retina.unoptimized > 0)
    warnings.push({
      type: 'retina_optimization',
      total: retina.total,
      unoptimized: retina.unoptimized,
      recommendation: 'Use SVG or srcset with 2x',
    });

  // Deliverability checks
  const trig = spamTriggers(text);
  if (trig.count > 0)
    warnings.push({
      type: 'spam_trigger_words',
      count: trig.count,
      examples: trig.hits.slice(0, 5),
    });

  const fonts = customFonts(html);
  if (fonts.used)
    warnings.push({type: 'custom_fonts', families: fonts.families.slice(0, 5)});

  const spam = heuristicSpamScore({text, html});
  warnings.push({type: 'spam_score', score: spam.score, level: spam.level});

  // Additional spam check: warn if image-to-text ratio is too high
  if (ratio.ratioImages > 60) {
    warnings.push({
      type: 'spam_image_ratio',
      ratioImages: ratio.ratioImages,
      recommendation: '<=60% images to reduce spam score',
    });
  }

  const total_checks = errors.length + warnings.length + passed.length;
  const penaltyErrors = errors.length * 25;
  const penaltyWarnings = warnings.length * 3;
  const bonusPassed = Math.min(20, passed.length * 2);
  const readiness_score = Math.max(
    0,
    Math.min(100, Math.round(100 - penaltyErrors - penaltyWarnings + bonusPassed)),
  );

  const structured_summary = {
    deliverability: {
      status: deliverabilityStatus(errors, warnings),
    },
    content: {
      status: contentStatus({content, errors, warnings}),
    },
    images: {
      issues: imageIssueCount({errors, warnings, accessibility}),
    },
    jinja: {
      issues: Array.isArray(jinja?.warnings) ? jinja.warnings.length : 0,
    },
  };

  const action_items = buildActionItems(errors, warnings, content);

  return {
    campaign: campaign || '',
    checked_at: nowIso(),
    domain: domain || '',
    dns,
    accessibility,
    rtl,
    jinja,
    total_checks,
    errors,
    warnings,
    passed,
    readiness_score,
    structured_summary,
    action_items,
  };
}

module.exports = {buildReport};

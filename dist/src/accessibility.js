const {extractLinks} = require('./checker');

const KNOWN_ROLES = new Set([
  'alert',
  'alertdialog',
  'application',
  'article',
  'banner',
  'button',
  'cell',
  'checkbox',
  'columnheader',
  'combobox',
  'complementary',
  'contentinfo',
  'dialog',
  'document',
  'feed',
  'figure',
  'form',
  'grid',
  'gridcell',
  'group',
  'heading',
  'img',
  'link',
  'list',
  'listbox',
  'listitem',
  'log',
  'main',
  'marquee',
  'math',
  'menu',
  'menubar',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'navigation',
  'none',
  'note',
  'option',
  'presentation',
  'progressbar',
  'radio',
  'radiogroup',
  'region',
  'row',
  'rowgroup',
  'rowheader',
  'scrollbar',
  'search',
  'searchbox',
  'separator',
  'slider',
  'spinbutton',
  'status',
  'switch',
  'tab',
  'table',
  'tablist',
  'tabpanel',
  'term',
  'textbox',
  'timer',
  'toolbar',
  'tooltip',
  'tree',
  'treegrid',
  'treeitem',
]);

const MAX_INLINE_IMAGE_BYTES = 500 * 1024; // 500KB to avoid oversized inline assets in emails

function stripTags(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ');
}

function collapseWhitespace(value) {
  return stripTags(value).replace(/\s+/g, ' ').trim();
}

function hasAccessibleName(startTag, innerText) {
  if (!startTag) return false;
  const hasAria = /aria-(label|labelledby|describedby)\s*=\s*["'][^"']+["']/i.test(startTag);
  if (hasAria) return true;
  const hasTitle = /title\s*=\s*["'][^"']+["']/i.test(startTag);
  if (hasTitle) return true;
  return collapseWhitespace(innerText).length > 0;
}

function normalizeFormat(format) {
  const value = String(format || '').toLowerCase().trim();
  if (!value) return 'email';
  if (value.includes('web') || value.includes('site') || value.includes('page')) return 'web';
  if (value.includes('email')) return 'email';
  return 'email';
}

function parseDataUriBytes(src) {
  const match = String(src || '').match(/^data:[^;]+;base64,([\s\S]+)/i);
  if (!match) return null;
  const b64 = match[1].trim();
  if (!b64) return 0;
  return Math.floor((b64.length * 3) / 4);
}

function retinaStats(imgTags) {
  let total = 0;
  let optimized = 0;
  imgTags.forEach((tag) => {
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

function analyzeAccessibility(html, options = {}) {
  const format = normalizeFormat(options.format);
  const isEmail = format === 'email';
  const warnings = [];
  const passed = [];
  const summary = [];

  const text = String(html || '');

  const clickableRegex = /<(div|span|li)\b[^>]*(on(?:click|keydown|keyup|keypress|mousedown|mouseup|touchstart|touchend|getfocus|focus|blur)|tabindex\s*=\s*["']0["'])[^>]*>/gi;
  const interactiveWithoutRole = [];
  const interactiveIssues = [];
  let clickableMatch;
  while ((clickableMatch = clickableRegex.exec(text)) !== null) {
    const snippet = clickableMatch[0];
    const roleMatch = snippet.match(/role\s*=\s*["']([^"']+)["']/i);
    if (!roleMatch) {
      interactiveWithoutRole.push(snippet);
    } else {
      const roleValue = roleMatch[1].trim().split(/\s+/)[0].toLowerCase();
      if (!KNOWN_ROLES.has(roleValue)) {
        interactiveIssues.push({snippet, role: roleValue, reason: 'invalid-role'});
      } else if (
        !/aria-(label|labelledby|describedby)\s*=\s*["'][^"']+["']/i.test(snippet) &&
        !/title\s*=\s*["'][^"']+["']/i.test(snippet)
      ) {
        interactiveIssues.push({snippet, role: roleValue, reason: 'missing-label'});
      }
    }
  }
  if (interactiveWithoutRole.length)
    warnings.push({
      type: 'interactive_missing_role',
      count: interactiveWithoutRole.length,
      recommendation: 'Добавьте role="button"/"link" и aria-label для кликабельных <div>/<span>',
    });

  const invalidRoles = [];
  const roleRegex = /role\s*=\s*["']([^"']+)["']/gi;
  let roleMatch;
  while ((roleMatch = roleRegex.exec(text)) !== null) {
    const raw = roleMatch[1].trim();
    if (!raw) continue;
    const primary = raw.split(/\s+/)[0].toLowerCase();
    if (!KNOWN_ROLES.has(primary)) invalidRoles.push(primary);
  }
  if (invalidRoles.length)
    warnings.push({
      type: 'invalid_role',
      count: invalidRoles.length,
      roles: Array.from(new Set(invalidRoles)).slice(0, 5),
      recommendation: 'Используйте допустимые значения role из спецификации WAI-ARIA',
    });

  const anchorsWithoutName = [];
  const anchorRegex = /<a\b[^>]*>([\s\S]*?)<\/a>/gi;
  let anchorMatch;
  while ((anchorMatch = anchorRegex.exec(text)) !== null) {
    const full = anchorMatch[0];
    const inner = anchorMatch[1];
    const start = full.match(/^<a\b[^>]*>/i)?.[0] || '';
    if (!/href\s*=\s*["'][^"']+["']/i.test(start)) continue;
    if (hasAccessibleName(start, inner)) continue;
    anchorsWithoutName.push(full); // store for count
  }
  if (anchorsWithoutName.length)
    warnings.push({
      type: 'links_without_label',
      count: anchorsWithoutName.length,
      recommendation: 'Добавьте текст ссылки или aria-label/aria-labelledby',
    });

  const buttonsWithoutName = [];
  const buttonRegex = /<button\b[^>]*>([\s\S]*?)<\/button>/gi;
  let buttonMatch;
  while ((buttonMatch = buttonRegex.exec(text)) !== null) {
    const full = buttonMatch[0];
    const inner = buttonMatch[1];
    const start = full.match(/^<button\b[^>]*>/i)?.[0] || '';
    if (hasAccessibleName(start, inner)) continue;
    buttonsWithoutName.push(full);
  }
  if (buttonsWithoutName.length)
    warnings.push({
      type: 'buttons_without_label',
      count: buttonsWithoutName.length,
      recommendation: 'Кнопки должны содержать текст или aria-label',
    });

  if (isEmail) {
    const imgTags = text.match(/<img\b[^>]*>/gi) || [];

    const missingAlt = imgTags.filter((tag) => {
      const m = tag.match(/\balt\s*=\s*["']([^"']*)["']/i);
      return !m || !m[1].trim();
    });
    if (missingAlt.length)
      warnings.push({
        type: 'email_missing_alt',
        count: missingAlt.length,
        recommendation: 'Добавьте alt-текст ко всем изображениям в письме',
      });
    else if (imgTags.length) {
      passed.push('email_alt_present');
    }

    const hasInlineCss = /style\s*=\s*["'][^"']+["']/i.test(text);
    if (!hasInlineCss)
      warnings.push({
        type: 'email_inline_css_missing',
        recommendation: 'Инлайн-стили повышают совместимость с почтовыми клиентами',
      });
    else passed.push('email_inline_css_present');

    const heavyInlineImages = [];
    imgTags.forEach((tag) => {
      const srcMatch = tag.match(/\bsrc=["']([^"']+)["']/i);
      const bytes = parseDataUriBytes(srcMatch && srcMatch[1]);
      if (bytes !== null && bytes > MAX_INLINE_IMAGE_BYTES) {
        heavyInlineImages.push({bytes, src: srcMatch[1]});
      }
    });
    if (heavyInlineImages.length)
      warnings.push({
        type: 'email_image_weight',
        count: heavyInlineImages.length,
        maxBytes: heavyInlineImages.reduce((max, img) => Math.max(max, img.bytes), 0),
        recommendation: 'Сжимайте инлайн-изображения до <500KB или выносите их в CDN',
      });

    const retina = retinaStats(imgTags);
    if (retina.unoptimized > 0)
      warnings.push({
        type: 'email_retina_missing',
        total: retina.total,
        unoptimized: retina.unoptimized,
        recommendation: 'Добавьте srcset c 2x или используйте SVG для ретина-экранов',
      });
    else if (retina.total) {
      passed.push('email_retina_ready');
    }

    if (Object.prototype.hasOwnProperty.call(options, 'preheader')) {
      const preheader = String(options.preheader || '').trim();
      if (!preheader)
        warnings.push({
          type: 'email_preheader_missing',
          recommendation: 'Добавьте прехедер (короткий текст в начале письма)',
        });
      else passed.push('email_preheader_present');
    }

    const links = extractLinks(text).filter((l) => l.tag === 'a' && l.attr === 'href');
    if (links.length) {
      const withUtm = links.filter((l) => /[?&]utm_/i.test(l.url)).length;
      const missingUtm = links.length - withUtm;
      if (missingUtm > 0)
        warnings.push({
          type: 'email_missing_utm',
          missing: missingUtm,
          recommendation: 'Добавьте utm-метки к ссылкам, чтобы отслеживать трафик',
        });
      else passed.push('email_utm_present');
    }
  }

  const ariaRolesMissingLabel = interactiveIssues.filter((x) => x.reason === 'missing-label');
  if (ariaRolesMissingLabel.length)
    warnings.push({
      type: 'role_without_label',
      count: ariaRolesMissingLabel.length,
      recommendation: 'Для элементов с role добавьте aria-label или видимый текст',
    });

  if (!warnings.length)
    summary.push('Адаптивность для скринридеров выглядит хорошо (основные проверки пройдены)');

  return {
    warnings,
    passed,
    summary,
    metrics: {
      interactiveWithoutRole: interactiveWithoutRole.length,
      anchorsWithoutLabel: anchorsWithoutName.length,
      buttonsWithoutLabel: buttonsWithoutName.length,
      format,
      emailMissingAlt: isEmail ? (warnings.find((w) => w.type === 'email_missing_alt')?.count || 0) : 0,
      emailInlineCss: isEmail ? /style\s*=\s*["'][^"']+["']/i.test(text) : null,
      emailInlineImagesOverLimit: isEmail
        ? warnings.find((w) => w.type === 'email_image_weight')?.count || 0
        : 0,
      emailRetinaUnoptimized: isEmail
        ? warnings.find((w) => w.type === 'email_retina_missing')?.unoptimized || 0
        : 0,
      emailMissingUtm: isEmail
        ? warnings.find((w) => w.type === 'email_missing_utm')?.missing || 0
        : 0,
    },
  };
}

module.exports = {analyzeAccessibility};

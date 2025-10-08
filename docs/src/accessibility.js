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

function analyzeAccessibility(html) {
  const warnings = [];
  const passed = [];
  const summary = [];

  const text = String(html || '');

  const hasMain = /<main\b/i.test(text) || /role\s*=\s*["']main["']/i.test(text);
  if (!hasMain)
    warnings.push({type: 'missing_landmark_main', recommendation: 'Добавьте <main> или role="main" для основного содержимого'});
  else passed.push('landmark_main');

  const hasHeader = /<header\b/i.test(text) || /role\s*=\s*["']banner["']/i.test(text);
  if (!hasHeader)
    warnings.push({type: 'missing_landmark_header', recommendation: 'Рассмотрите использование <header> или role="banner"'});
  else passed.push('landmark_header');

  const hasFooter = /<footer\b/i.test(text) || /role\s*=\s*["']contentinfo["']/i.test(text);
  if (!hasFooter)
    warnings.push({type: 'missing_landmark_footer', recommendation: 'Рассмотрите использование <footer> или role="contentinfo"'});
  else passed.push('landmark_footer');

  const navCount = (text.match(/<nav\b/gi) || []).length + (text.match(/role\s*=\s*["']navigation["']/gi) || []).length;
  if (!navCount)
    warnings.push({type: 'missing_landmark_navigation', recommendation: 'Добавьте <nav> или role="navigation" для основного меню'});
  else passed.push('landmark_navigation');

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
    } else if (!/aria-(label|labelledby|describedby)\s*=\s*["'][^"']+["']/i.test(snippet) && !/title\s*=\s*["'][^"']+["']/i.test(snippet)) {
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
      hasMain,
      hasHeader,
      hasFooter,
      navCount,
      interactiveWithoutRole: interactiveWithoutRole.length,
      anchorsWithoutLabel: anchorsWithoutName.length,
      buttonsWithoutLabel: buttonsWithoutName.length,
    },
  };
}

module.exports = {analyzeAccessibility};

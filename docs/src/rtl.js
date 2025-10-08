function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ');
}

const RTL_REGEX = /[\u0590-\u08FF]/u;
const RTL_GLOBAL = /[\u0590-\u08FF]/gu;
const LTR_GLOBAL = /[A-Za-z\u0400-\u04FF\u0100-\u024F]/gu; // Latin + Cyrillic + extended Latin as LTR proxy

function countMatches(regex, text) {
  if (!text) return 0;
  let count = 0;
  let match;
  while ((match = regex.exec(text)) !== null) count += match[0].length;
  return count;
}

function analyzeRtl(html) {
  const text = stripHtml(html);
  const rtlChars = countMatches(RTL_GLOBAL, text);
  const ltrChars = countMatches(LTR_GLOBAL, text);
  const totalLetters = rtlChars + ltrChars;
  const rtlShare = totalLetters ? Math.round((rtlChars / totalLetters) * 100) : 0;

  const warnings = [];
  const passed = [];
  const summary = [];

  const hasDirRtl = /dir\s*=\s*["']rtl["']/i.test(html || '');
  const hasDirLtr = /dir\s*=\s*["']ltr["']/i.test(html || '');
  const hasDirectionCss = /direction\s*:\s*rtl/i.test(html || '');
  const hasLangRtl = /lang\s*=\s*["'](ar|he|fa|ur|dv|ku|ps|sd|ug|yi)["']/i.test(html || '');

  if (rtlShare >= 30) {
    summary.push('Обнаружены RTL символы (' + rtlShare + '% текста).');
    if (hasDirRtl || hasDirectionCss) {
      passed.push('rtl_layout_defined');
    } else {
      warnings.push({
        type: 'rtl_missing_direction',
        rtlShare,
        recommendation: 'Добавьте dir="rtl" на контейнеры или стиль direction:rtl',
      });
    }

    if (!hasLangRtl)
      warnings.push({
        type: 'rtl_missing_lang',
        rtlShare,
        recommendation: 'Добавьте lang="ar"/"he"/... на <html> или секцию письма',
      });
  } else {
    summary.push('RTL контента не обнаружено (доля ' + rtlShare + '%).');
    if (hasDirRtl || hasDirectionCss)
      warnings.push({
        type: 'rtl_direction_without_content',
        rtlShare,
        recommendation: 'Уберите dir="rtl" или direction:rtl, если письмо не для RTL',
      });
  }

  if (hasDirLtr && rtlShare >= 30)
    warnings.push({
      type: 'rtl_conflicting_direction',
      rtlShare,
      recommendation: 'dir="ltr" конфликтует с содержимым RTL, используйте dir="rtl"',
    });

  return {
    warnings,
    passed,
    summary,
    metrics: {
      rtlShare,
      rtlChars,
      ltrChars,
      hasDirRtl,
      hasDirLtr,
      hasDirectionCss,
      hasLangRtl,
    },
  };
}

module.exports = {analyzeRtl};

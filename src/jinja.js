const BLOCK_OPENERS = new Set([
  'if',
  'for',
  'block',
  'macro',
  'filter',
  'with',
  'call',
  'trans',
  'autoescape',
]);
const BLOCK_NEUTRAL = new Set(['elif', 'else']);

function firstToken(str) {
  return (str.trim().split(/\s+/)[0] || '').toLowerCase();
}

function analyzeExpressions(text, warnings, metrics) {
  let pos = 0;
  while (true) {
    const start = text.indexOf('{{', pos);
    if (start === -1) break;
    let openLen = 2;
    if (text[start + 2] === '-') openLen = 3;
    const end = text.indexOf('}}', start + openLen);
    metrics.totalExpressions += 1;
    if (end === -1) {
      warnings.push({
        type: 'jinja_unclosed_expression',
        position: start,
        recommendation: 'Закройте {{ }} для выражения Jinja',
      });
      metrics.unclosedExpressions += 1;
      pos = start + openLen;
      break;
    }
    const inner = text.slice(start + openLen, end).replace(/-$/, '').trim();
    if (!inner) {
      warnings.push({
        type: 'jinja_empty_expression',
        position: start,
        recommendation: 'Выражение Jinja не должно быть пустым',
      });
      metrics.emptyExpressions += 1;
    }
    const invalid = /[^A-Za-z0-9_\s\.\|\'"()\[\]\-:,]/.test(inner);
    if (invalid) {
      warnings.push({
        type: 'jinja_suspicious_expression',
        position: start,
        expression: inner.slice(0, 60),
        recommendation: 'Проверьте синтаксис фильтров/переменных',
      });
      metrics.suspiciousExpressions += 1;
    }
    pos = end + 2;
  }
}

function analyzeStatements(text, warnings, metrics) {
  let pos = 0;
  const stack = [];
  while (true) {
    const start = text.indexOf('{%', pos);
    if (start === -1) break;
    let openLen = 2;
    if (text[start + 2] === '-') openLen = 3;
    const end = text.indexOf('%}', start + openLen);
    metrics.totalStatements += 1;
    if (end === -1) {
      warnings.push({
        type: 'jinja_unclosed_statement',
        position: start,
        recommendation: 'Закройте {% %} для конструкции Jinja',
      });
      metrics.unclosedStatements += 1;
      pos = start + openLen;
      break;
    }
    const innerRaw = text.slice(start + openLen, end).replace(/-$/, '');
    const inner = innerRaw.trim();
    const token = firstToken(inner);
    if (token.startsWith('end')) {
      const closing = token.slice(3);
      const current = stack.pop();
      if (!current) {
        warnings.push({
          type: 'jinja_unmatched_end',
          statement: token,
          recommendation: 'Удалите лишний ' + token + ' или добавьте соответствующий блок',
        });
        metrics.unmatchedEnds += 1;
      } else if (closing && current !== closing) {
        warnings.push({
          type: 'jinja_mismatched_end',
          expected: current,
          actual: closing,
          recommendation: 'Закройте блок ' + current + ' тегом end' + current,
        });
        metrics.mismatchedEnds += 1;
      }
    } else if (BLOCK_NEUTRAL.has(token)) {
      if (!stack.length) {
        warnings.push({
          type: 'jinja_orphan_else',
          statement: token,
          recommendation: 'Используйте ' + token + ' внутри if/for блока',
        });
        metrics.orphanNeutral += 1;
      }
    } else if (BLOCK_OPENERS.has(token)) {
      stack.push(token);
    }
    pos = end + 2;
  }
  if (stack.length) {
    warnings.push({
      type: 'jinja_unclosed_block',
      openBlocks: stack.slice(0, 5),
      recommendation: 'Добавьте end...' + ' для всех открытых блоков',
    });
  }
  metrics.openBlocks = stack.length;
}

function analyzeComments(text, metrics) {
  let pos = 0;
  while (true) {
    const start = text.indexOf('{#', pos);
    if (start === -1) break;
    const end = text.indexOf('#}', start + 2);
    metrics.totalComments += 1;
    if (end === -1) {
      metrics.unclosedComments += 1;
      break;
    }
    pos = end + 2;
  }
}

function analyzeJinja(html) {
  const text = String(html || '');
  const warnings = [];
  const passed = [];
  const summary = [];
  const metrics = {
    totalExpressions: 0,
    totalStatements: 0,
    totalComments: 0,
    unclosedExpressions: 0,
    unclosedStatements: 0,
    unclosedComments: 0,
    emptyExpressions: 0,
    suspiciousExpressions: 0,
    mismatchedEnds: 0,
    unmatchedEnds: 0,
    orphanNeutral: 0,
    openBlocks: 0,
  };

  analyzeExpressions(text, warnings, metrics);
  analyzeStatements(text, warnings, metrics);
  analyzeComments(text, metrics);

  if (!warnings.length && metrics.totalExpressions + metrics.totalStatements > 0)
    summary.push('Jinja конструкции выглядят корректно.');
  if (!warnings.length && metrics.totalExpressions + metrics.totalStatements === 0)
    summary.push('Jinja-шаблонов не обнаружено.');

  if (warnings.length === 0 && metrics.totalExpressions + metrics.totalStatements > 0)
    passed.push('jinja_balanced');

  return {warnings, passed, summary, metrics};
}

module.exports = {analyzeJinja};

function stripHtml(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ');
}

function detectLangMix(text) {
  const ru = (text.match(/[А-Яа-яЁё]/g) || []).length;
  const en = (text.match(/[A-Za-z]/g) || []).length;
  const totalLetters = ru + en;
  const ratioRu = totalLetters ? ru / totalLetters : 0;
  const ratioEn = totalLetters ? en / totalLetters : 0;
  return {ru, en, ratioRu, ratioEn};
}

function basicSpellHeuristics(text) {
  // Heuristics: repeated punctuation, 3+ exclamations, repeated letters 4+, double spaces
  const tooManyExclamations = /(!!!|\?\?\?|!\?|\?!)/.test(text);
  const repeatedLetters = /(.)\1{3,}/i.test(text);
  const doubleSpaces = / {2,}/.test(text);
  // Naive typo patterns (common EN typos appearing in RU mail): teh->the, recieve->receive, adress->address
  const commonTypos =
    /(teh|recieve|adress|occured|seperat|definately|wich)/i.test(text);
  return {tooManyExclamations, repeatedLetters, doubleSpaces, commonTypos};
}

function toneHeuristics(text) {
  const capsWords = (text.match(/\b[A-ZА-ЯЁ]{4,}\b/g) || []).length;
  const spammy =
    /(100%\s*FREE|FREE\b|EARN MONEY|КУПИ|СКИДКА\s*\d+%|!!!!)/i.test(text);
  const exclamations = (text.match(/!/g) || []).length;
  return {capsWords, spammy, exclamations};
}

function parentFriendliness(text) {
  const blacklist = [
    // mild profanity/adult content markers (RU/EN minimal set)
    'xxx',
    'porn',
    'sex',
    'эрот',
    'порно',
    'сука',
    'блять',
    'нах',
  ];
  const hits = [];
  const lower = text.toLowerCase();
  blacklist.forEach((w) => {
    if (lower.indexOf(w) !== -1) hits.push(w);
  });
  return {blacklistHits: hits};
}

function clarityHeuristics(text) {
  const sentences = text
    .replace(/\s+/g, ' ')
    .split(/[.!?]+\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length);
  const words = text.trim().split(/\s+/).filter(Boolean);
  const avgSentenceLen = sentences.length
    ? Math.round(words.length / sentences.length)
    : words.length;
  const longSentences = sentences.filter(
    (s) => s.split(/\s+/).length > 25,
  ).length;
  return {
    sentences: sentences.length,
    words: words.length,
    avgSentenceLen,
    longSentences,
  };
}

function htmlQuality(html) {
  const imgNoAlt = (html.match(/<img\b(?![^>]*\balt=)[^>]*>/gi) || []).length;
  const emptyLinks = (html.match(/<a\b[^>]*href=["']#?["'][^>]*>/gi) || [])
    .length;
  return {imgNoAlt, emptyLinks};
}

function imageToTextRatio(html, text) {
  const imgCount = (html.match(/<img\b/gi) || []).length;
  const textLen = text.trim().length;
  const imgWeight = imgCount * 100; // simple heuristic weight per image
  const total = imgWeight + textLen;
  const ratioImages = total ? Math.round((imgWeight / total) * 100) : 0;
  return {imgCount, textLen, ratioImages};
}

function runContentChecks(html) {
  const text = stripHtml(html);
  const lang = detectLangMix(text);
  const spelling = basicSpellHeuristics(text);
  const tone = toneHeuristics(text);
  const parent = parentFriendliness(text);
  const clarity = clarityHeuristics(text);
  const htmlq = htmlQuality(html);
  const ratio = imageToTextRatio(html, text);

  // Summaries
  const summary = [];
  if (lang.ratioRu > 0.2 && lang.ratioEn > 0.2)
    summary.push('Смешение языков RU/EN заметно');
  if (spelling.tooManyExclamations || tone.exclamations > 6)
    summary.push('Много восклицательных знаков');
  if (spelling.repeatedLetters)
    summary.push('Повторы букв (эмоциональность/ошибка)');
  if (spelling.doubleSpaces) summary.push('Двойные пробелы');
  if (spelling.commonTypos) summary.push('Замечены частые опечатки (EN)');
  if (tone.spammy || tone.capsWords > 8) summary.push('Агрессивный/спам‑тон');
  if (parent.blacklistHits.length) summary.push('Найден нежелательный контент');
  if (clarity.avgSentenceLen > 22 || clarity.longSentences > 0)
    summary.push('Длинные предложения — проверьте ясность');
  if (htmlq.imgNoAlt) summary.push('Изображения без alt');
  if (htmlq.emptyLinks) summary.push('Пустые/"#" ссылки');
  if (ratio.ratioImages > 60)
    summary.push('Высокая доля изображений относительно текста');

  return {
    textChars: text.length,
    language: lang,
    spelling,
    tone,
    parentFriendliness: parent,
    clarity,
    htmlQuality: htmlq,
    imageToTextRatio: ratio,
    summary,
  };
}

module.exports = {runContentChecks, imageToTextRatio};

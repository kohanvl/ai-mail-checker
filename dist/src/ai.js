let theFetch = typeof fetch !== 'undefined' ? fetch : null;
if (!theFetch) {
  try {
    theFetch = require('node-fetch');
  } catch (_) {
    /* ignore */
  }
}

// Lightweight .env support for OPENAI_API_KEY
if (!process.env.OPENAI_API_KEY) {
  try {
    const fs = require('fs');
    const path = require('path');
    const envPath = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      content.split(/\r?\n/).forEach((line) => {
        const m = line.match(/^\s*OPENAI_API_KEY\s*=\s*(.+)\s*$/);
        if (m && !process.env.OPENAI_API_KEY) {
          const val = m[1].replace(/^['"]|['"]$/g, '');
          if (val) process.env.OPENAI_API_KEY = val;
        }
      });
    }
  } catch (_) {
    /* ignore */
  }
}

async function callOpenAI(
  messages,
  {model = 'gpt-4o-mini', temperature = 0.2} = {},
) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {supported: false, error: 'OPENAI_API_KEY is not set'};
  }
  if (!theFetch) {
    return {
      supported: false,
      error: 'fetch is unavailable in this Node environment',
    };
  }
  try {
    const r = await theFetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        model,
        temperature,
        messages,
        response_format: {type: 'json_object'},
      }),
    });
    if (!r.ok) {
      const text = await r.text();
      return {supported: false, error: 'OpenAI HTTP ' + r.status + ': ' + text};
    }
    const data = await r.json();
    const content =
      data.choices &&
      data.choices[0] &&
      data.choices[0].message &&
      data.choices[0].message.content;
    return {supported: true, contentRaw: content};
  } catch (e) {
    return {supported: false, error: e && (e.message || String(e))};
  }
}

function buildPrompt(html) {
  return [
    {
      role: 'system',
      content:
        'You are an expert email content reviewer. Return strict JSON with keys: summary (string), tone (string), issues (array of strings), suggestions (array of strings). Keep it concise and actionable.',
    },
    {
      role: 'user',
      content:
        'Review the following email HTML for tone, clarity, parent-friendliness, translation issues, spelling/grammar, and overall quality across devices. Provide suggestions. HTML:\n\n' +
        html,
    },
  ];
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

async function analyzeEmailWithAI(html) {
  const res = await callOpenAI(buildPrompt(String(html)));
  if (!res.supported) return res;
  let json = safeParseJson(res.contentRaw || '');
  if (!json || typeof json !== 'object') {
    json = {
      summary: String(res.contentRaw || '').slice(0, 2000),
      tone: '',
      issues: [],
      suggestions: [],
    };
  }
  return {supported: true, result: json};
}

module.exports = {analyzeEmailWithAI};

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
  {model = 'gpt-4o', temperature = 0.2} = {},
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
      }),
    });
    if (!r.ok) {
      const text = await r.text();
      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch (_) {
        /* ignore */
      }
      if (r.status === 401) {
        const code = parsed?.error?.code;
        if (code === 'account_deactivated') {
          return {
            supported: false,
            error:
              'OpenAI account is deactivated. Reactivate the account or use a different API key.',
          };
        }
        if (code === 'invalid_api_key') {
          return {
            supported: false,
            error: 'Invalid OpenAI API key. Check OPENAI_API_KEY and try again.',
          };
        }
      }
      return {
        supported: false,
        error:
          'OpenAI HTTP ' +
          r.status +
          ': ' +
          (parsed ? JSON.stringify(parsed) : text),
      };
    }
    const data = await r.json();
    const content =
      data.choices &&
      data.choices[0] &&
      data.choices[0].message &&
      data.choices[0].message.content;
    return {supported: true, contentRaw: content};
  } catch (e) {
    let message = e && (e.message || String(e));
    const cause = e && e.cause;
    if (cause) {
      const parts = [];
      if (cause.code) parts.push(cause.code);
      if (cause.hostname) parts.push(cause.hostname);
      if (cause.port) parts.push(String(cause.port));
      const causeText = [cause.message, parts.join(' ')].filter(Boolean).join(' — ');
      message =
        'Network error contacting OpenAI: ' +
        (causeText || message || 'fetch failed') +
        '. Check connectivity, DNS, or proxy/VPN settings.';
    } else if (message === 'fetch failed') {
      message =
        'Network error contacting OpenAI: fetch failed. Check connectivity, DNS, or proxy/VPN settings.';
    }
    return {supported: false, error: message};
  }
}

function buildPrompt(html) {
  const basePrompt = `You are an Email QA & Communication Quality AI built for Novakid, an online English school for children aged 4–15.
Your task is to analyze the uploaded email HTML and generate a clear, actionable report that helps CRM managers improve:
communication quality
structure
tone of voice
clarity of message
regional adaptation
visual consistency
brand alignment
parent orientation
potential risks
conversion likelihood

Your response must be structured, concise, and written for a CRM manager, not a developer.

🔶 GLOBAL RULES
1️⃣ Parent-centric communication (must always apply)
Novakid always speaks to parents, not children.
You must check:
Does the email talk directly to the child instead of the parent?
Does the message address parental motivations (progress, safety, time-saving, value)?
Does the email clearly show what benefit the child gets AND why the parent should act?
Output:
Parent-focus score (1–10)
Lines that incorrectly address the child
Corrected versions addressing the parent


🔶 STRUCTURE OF OUTPUT (IMPORTANT)
Your final answer must follow this format:

1. Summary (2–4 sentences)
What the email is about and the main communication issue.

2. Goal Detection & Messaging Clarity
Determine the core objective as YOU understood it.
Check:
Is the goal clear?
Does all content support this goal?
Are there unnecessary blocks?
Is CTA aligned with the goal?
Output:
Primary goal identified by AI
Goal clarity score (1–10)
Blocks that distract from the goal
Missing blocks (if any)

3. Text Quality Review
Analyze:
🔹 Tone of Voice (TOV)
Should be:
supportive, warm, expert, empathetic, motivating, not pushy.
Check for:
unnatural formality
sales pressure
robotic phrasing
inconsistency with Novakid brand voice
emotional mismatch
Give:
TOV score (1–10)
examples of problems
suggested rewrites


🔹 Readability & Flow
Check:
sentence length
complexity
clarity
logic between paragraphs
whether parent sees the value fast
Give:
readability score (1–10)
problematic lines
improved versions


4. Structural Review
Analyze layout and logic:
order of blocks
whether hero message is clear
CTA placement
scannability
hierarchy
contrast between sections
amount of copy vs visuals
Output:
structure score (1–10)
what feels misplaced
recommended new structure (bullet list)

5. Visual & Design Review
Analyze visual language based on the HTML:
🔹 Color logic
Are colors aligned with message tone and Novakid brand?
Is contrast sufficient?
Are dark-mode issues visible?
Does visual style help conversion?
🔹 Images
Do images support the message?
Are images confusing, irrelevant, or too childish for parents?
Do images break in dark mode?
Output:
visual score (1–10)
\"what the user will see\" (interpretation from HTML)
dark-mode risks
suggestions with reasoning


6. Brand Consistency Check (Novakid)
Evaluate compliance with:
Novakid visual identity
tone of communication
values: progress, safe environment, learning through play, expertise, trust
Output:
brand alignment score (1–10)
what matches well
what breaks brand expectations
specific recommendations


7. Regional Adaptation Review
Analyze how the email will be perceived across cultures.
Regions to evaluate:
TR, RO, IL, ARAB, RU, DE, FR, IT, CZ, KR, JP, ES, LATAM, GLOBAL (US/UK)
Check for:
cultural sensitivity
different attitudes to discounts, holidays, emojis, urgency
local taboos
religious constraints
tone mismatches
humor issues
visuals that may not work universally
words that may not translate well
Output:
For each region (only list the ones where issues exist):
risk level (low / medium / high)
what may be misunderstood
recommendation for translators


8. Emotional & Psychological Impact
Analyze how a parent will FEEL reading the email:
safe / pressured / confused / inspired?
is the value proposition strong?
does it reduce parental anxiety?
does it motivate action?
Give:
emotional impact score (1–10)
emotional tone description
psychological barriers detected
fixes


9. Red Flags & Conversion Risks
List top 5–10 issues that can hurt:
conversions
understanding
trust
email performance
Mark each as:
❗️HIGH / ⚠️Medium / ℹ️Low

10. Priority Fix List
List 5–7 things the CRM manager must fix FIRST.

11. Optional Rewritten Version
Provide an improved version of the main text with:
stronger TOV
clearer message
better parent focus
improved CTA
culturally neutral phrasing


🔷 END OF PROMPT`;
  return [
    {
      role: 'system',
      content:
        'You are an AI assistant that reviews email HTML for Novakid CRM managers. Follow the provided structure exactly, keep it concise, and avoid developer jargon.',
    },
    {
      role: 'user',
      content:
        basePrompt +
        '\n\nAnalyze this email HTML and respond using the structure above. HTML:\n"""\n' +
        html +
        '\n"""',
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

function extractPlainText(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function calcTextStats(text) {
  const words = text ? text.split(/\s+/).filter(Boolean) : [];
  const sentences = text ? text.split(/[.!?]+/).filter((s) => s.trim().length) : [];
  const avgSentenceLen = sentences.length
    ? Math.round(words.length / sentences.length)
    : words.length;
  return {wordCount: words.length, sentenceCount: sentences.length, avgSentenceLen};
}

function detectGoal(text) {
  const lower = text.toLowerCase();
  if (lower.includes('trial') || lower.includes('book')) return 'Book a trial class';
  if (lower.includes('discount') || lower.includes('% off') || lower.includes('sale'))
    return 'Promote a discount or offer';
  if (lower.includes('progress') || lower.includes('lesson')) return 'Share learning progress';
  return 'General engagement / update';
}

function findChildAddressingLines(text) {
  const lines = text.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
  return lines.filter((l) =>
    /\b(kid|child|you|buddy|young learner|student)\b/i.test(l),
  );
}

function buildOfflineReport(html) {
  const text = extractPlainText(html);
  const stats = calcTextStats(text);
  const goal = detectGoal(text);
  const childLines = findChildAddressingLines(text);
  const parentScore = Math.max(1, 10 - childLines.length);
  const readabilityScore = Math.max(
    1,
    Math.min(10, 12 - Math.round(stats.avgSentenceLen / 2)),
  );
  const tovScore = 7;
  const structureScore = 7;
  const visualScore = 6;
  const brandScore = 7;
  const emotionalScore = 7;

  const summaryCopy = [
    `Email likely aims to ${goal.toLowerCase()}.`,
    'Offline heuristic review: keep parent-centric wording and tighten clarity.',
  ].join(' ');

  const blocks =
    text.length < 40
      ? ['Email body is very short; add a clear hero message and CTA.']
      : ['Ensure CTA and offer blocks stay focused on booking a class.'];

  const reportSections = [
    `1. Summary`,
    summaryCopy,
    '',
    `2. Goal Detection & Messaging Clarity`,
    `Primary goal identified by AI: ${goal}`,
    `Goal clarity score (1–10): 7`,
    `Blocks that distract from the goal: ${blocks.join('; ')}`,
    `Missing blocks (if any): Add a concise hero + CTA if absent.`,
    '',
    `3. Text Quality Review`,
    `TOV score (1–10): ${tovScore}`,
    `Examples of problems: avoid child-directed "you" phrasing; keep warmth without pushiness.`,
    `Suggested rewrites: Rephrase child-facing lines to speak to parents about their child’s progress.`,
    `Readability score (1–10): ${readabilityScore}`,
    `Problematic lines: ${childLines.slice(0, 3).join(' | ') || 'Not detected; still check manually.'}`,
    `Improved versions: Focus on what parents gain (time saved, progress, safety).`,
    '',
    `4. Structural Review`,
    `Structure score (1–10): ${structureScore}`,
    `What feels misplaced: Long paragraphs or offers buried below the fold.`,
    `Recommended new structure (bullet list): Hero (benefit + parent value); Key proof/benefit; CTA; How it works; Secondary info; Footer.`,
    '',
    `5. Visual & Design Review`,
    `Visual score (1–10): ${visualScore}`,
    `"What the user will see": Color and imagery cannot be fully assessed offline; ensure contrast and parent-oriented visuals.`,
    `Dark-mode risks: Inline styles without dark-mode rules may invert logos; test in Gmail/Apple dark.`,
    `Suggestions with reasoning: Keep CTA buttons high-contrast; avoid heavy child imagery without parent framing.`,
    '',
    `6. Brand Consistency Check (Novakid)`,
    `Brand alignment score (1–10): ${brandScore}`,
    `What matches well: Emphasis on learning outcomes and friendly tone.`,
    `What breaks brand expectations: Any direct child-speak or aggressive sales push.`,
    `Specific recommendations: Highlight expert teachers, safe environment, and progress tracking for parents.`,
    '',
    `7. Regional Adaptation Review`,
    `Issues: Not fully assessed offline; avoid idioms and aggressive urgency for DE/FR; keep discounts clear for LATAM/TR; limit emojis for JP/KR.`,
    '',
    `8. Emotional & Psychological Impact`,
    `Emotional impact score (1–10): ${emotionalScore}`,
    `Emotional tone description: Warm and supportive recommended; avoid pressure.`,
    `Psychological barriers detected: Potential confusion if CTA/value not upfront.`,
    `Fixes: Lead with clear benefit for the child + action for the parent, add reassurance on safety and progress.`,
    '',
    `9. Red Flags & Conversion Risks`,
    `❗️HIGH: Missing clear CTA or parent benefit statement.`,
    `⚠️Medium: Child-directed copy; long paragraphs reducing scannability.`,
    `ℹ️Low: Weak dark-mode contrast; generic imagery.`,
    '',
    `10. Priority Fix List`,
    `- Make hero headline parent-focused with specific benefit.`,
    `- Place primary CTA near top; repeat near footer.`,
    `- Shorten sentences; front-load value in first lines.`,
    `- Replace child-facing lines with parent-oriented wording.`,
    `- Add reassurance on safety/progress and a concise "how it works".`,
    '',
    `11. Optional Rewritten Version`,
    `Stronger TOV example: "See how quickly your child progresses with Novakid — book a short demo class today. Parents get a clear lesson plan, safe environment, and flexible scheduling."`,
  ].join('\n');

  return {
    summary: summaryCopy,
    report: reportSections,
  };
}

async function analyzeEmailWithAI(html) {
  const htmlString = String(html || '');

  if (!process.env.OPENAI_API_KEY || !theFetch) {
    return {supported: true, result: buildOfflineReport(htmlString)};
  }

  const res = await callOpenAI(buildPrompt(htmlString));
  if (!res.supported) return res;

  const reportText = String(res.contentRaw || '').trim();
  const summaryMatch = reportText.match(
    /1\.\s*Summary[\s\S]*?(?=\n\s*\d+\.\s|$)/i,
  );
  const summary =
    (summaryMatch && summaryMatch[0] && summaryMatch[0].trim()) ||
    reportText.slice(0, 400);

  return {
    supported: true,
    result: {
      summary,
      report: reportText,
    },
  };
}

module.exports = {analyzeEmailWithAI};

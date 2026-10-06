export type ContactKind = "phone" | "email" | "link" | "handle";

export type ContactRules = {
  enabled: boolean;
  minDigits: number;
  extraPatterns: string[];
};

export const DEFAULT_CONTACT_RULES: ContactRules = { enabled: true, minDigits: 9, extraPatterns: [] };
export const CONTACT_REDACTION = "[contact information hidden]";

const DIGIT_WORDS = "zero|oh|nul|one|two|three|four|five|six|seven|eight|nine";
const TOKEN = new RegExp(`\\d+|\\b(?:${DIGIT_WORDS})\\b|\\+|[\\s.\\-_()/]+|[^\\s]`, "gi");
const DIGIT_WORD = new RegExp(`^(?:${DIGIT_WORDS})$`, "i");
const EMAIL = /[a-z0-9._%+-]+\s*(?:@|\(at\)|\[at\]|\sat\s)\s*[a-z0-9-]+(?:\s*(?:\.|\(dot\)|\[dot\]|\sdot\s)\s*[a-z0-9-]+)*\s*(?:\.|\(dot\)|\[dot\]|\sdot\s)\s*[a-z]{2,}\b/gi;
const LINK = /\b(?:https?:\/\/|www\.|wa\.me\/|t\.me\/|bit\.ly\/)\S+/gi;
const HANDLE = /(?<![\w.])@[a-z0-9._]{3,}/gi;
const CURRENCY_BEFORE = /(?:\bR|\bZAR|\$|\u20ac|\u00a3|\bprice:?|\bR\s)\s*$/i;

type Span = { start: number; end: number; kind: ContactKind };

function phoneSpans(text: string, minDigits: number): Span[] {
  const spans: Span[] = [];
  let runStart = -1;
  let lastDigitEnd = -1;
  let digits = 0;
  const flush = () => {
    if (runStart >= 0 && digits >= minDigits && !CURRENCY_BEFORE.test(text.slice(Math.max(0, runStart - 12), runStart))) {
      spans.push({ start: runStart, end: lastDigitEnd, kind: "phone" });
    }
    runStart = -1;
    lastDigitEnd = -1;
    digits = 0;
  };
  for (const match of text.matchAll(TOKEN)) {
    const token = match[0];
    const index = match.index ?? 0;
    const isDigits = /^\d+$/.test(token);
    const isWord = DIGIT_WORD.test(token);
    if (isDigits || isWord) {
      if (runStart < 0) runStart = index;
      digits += isDigits ? token.length : 1;
      lastDigitEnd = index + token.length;
    } else if (token === "+") {
      if (runStart < 0) runStart = index;
    } else if (/^[\s.\-_()/]+$/.test(token)) {
      // separators keep the run alive, but a long gap ends it
      if (token.length > 4) flush();
    } else {
      flush();
    }
  }
  flush();
  return spans;
}

function regexSpans(text: string, pattern: RegExp, kind: ContactKind): Span[] {
  return [...text.matchAll(pattern)].map((m) => ({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, kind }));
}

export function findContactInfo(text: string, rules: ContactRules = DEFAULT_CONTACT_RULES): Span[] {
  if (!rules.enabled || !text) return [];
  const spans = [
    ...regexSpans(text, EMAIL, "email"),
    ...regexSpans(text, LINK, "link"),
    ...regexSpans(text, HANDLE, "handle"),
    ...phoneSpans(text, rules.minDigits),
  ];
  for (const source of rules.extraPatterns) {
    try {
      spans.push(...regexSpans(text, new RegExp(source, "gi"), "link"));
    } catch {
      // an invalid admin-supplied pattern must never break content writes
    }
  }
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: Span[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  return merged;
}

export function sanitizePublicText(text: string, rules: ContactRules = DEFAULT_CONTACT_RULES) {
  const spans = findContactInfo(text, rules);
  if (!spans.length) return { text, changed: false, kinds: [] as ContactKind[] };
  let out = "";
  let cursor = 0;
  for (const span of spans) {
    out += text.slice(cursor, span.start) + CONTACT_REDACTION;
    cursor = span.end;
  }
  out += text.slice(cursor);
  return { text: out, changed: true, kinds: [...new Set(spans.map((s) => s.kind))] };
}

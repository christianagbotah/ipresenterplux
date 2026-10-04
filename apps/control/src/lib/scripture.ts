const BOOKS: Record<string, string> = {
  genesis: "Genesis", exodus: "Exodus", leviticus: "Leviticus", numbers: "Numbers",
  deuteronomy: "Deuteronomy", joshua: "Joshua", judges: "Judges", ruth: "Ruth",
  "1 samuel": "1 Samuel", "2 samuel": "2 Samuel", "1 kings": "1 Kings", "2 kings": "2 Kings",
  "1 chronicles": "1 Chronicles", "2 chronicles": "2 Chronicles", ezra: "Ezra", nehemiah: "Nehemiah",
  esther: "Esther", job: "Job", psalm: "Psalms", psalms: "Psalms", proverbs: "Proverbs",
  ecclesiastes: "Ecclesiastes", "song of solomon": "Song of Solomon", isaiah: "Isaiah",
  jeremiah: "Jeremiah", lamentations: "Lamentations", ezekiel: "Ezekiel", daniel: "Daniel",
  hosea: "Hosea", joel: "Joel", amos: "Amos", obadiah: "Obadiah", jonah: "Jonah",
  micah: "Micah", nahum: "Nahum", habakkuk: "Habakkuk", zephaniah: "Zephaniah",
  haggai: "Haggai", zechariah: "Zechariah", malachi: "Malachi", matthew: "Matthew",
  mark: "Mark", luke: "Luke", john: "John", acts: "Acts", romans: "Romans",
  "1 corinthians": "1 Corinthians", "2 corinthians": "2 Corinthians", galatians: "Galatians",
  ephesians: "Ephesians", philippians: "Philippians", colossians: "Colossians",
  "1 thessalonians": "1 Thessalonians", "2 thessalonians": "2 Thessalonians",
  "1 timothy": "1 Timothy", "2 timothy": "2 Timothy", titus: "Titus", philemon: "Philemon",
  hebrews: "Hebrews", james: "James", "1 peter": "1 Peter", "2 peter": "2 Peter",
  "1 john": "1 John", "2 john": "2 John", "3 john": "3 John", jude: "Jude", revelation: "Revelation",
};

const NUMBER_VALUES: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const UNIT_WORDS = "one|two|three|four|five|six|seven|eight|nine";
const TEEN_WORDS = "ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen";
const TENS_WORDS = "twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety";
const UNDER_HUNDRED = `(?:${TEEN_WORDS}|(?:${TENS_WORDS})(?:[ -](?:${UNIT_WORDS}))?|${UNIT_WORDS})`;
const HUNDREDS = String.raw`(?:(?:${UNIT_WORDS})\s+hundred(?:\s+and)?(?:\s+${UNDER_HUNDRED})?)`;
const THOUSANDS = String.raw`(?:(?:${HUNDREDS}|${UNDER_HUNDRED})\s+thousand(?:\s+(?:${HUNDREDS}|${UNDER_HUNDRED}))?)`;
const SPOKEN_NUMBER_PATTERN = new RegExp(String.raw`\b(?:${THOUSANDS}|${HUNDREDS}|${UNDER_HUNDRED})\b`, "gi");

export type ScriptureDetection = {
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd?: number;
  reference: string;
  confidence: number;
};

export type ContextualScriptureIntent =
  | { kind: "nextVerse" }
  | { kind: "previousVerse" }
  | { kind: "nextChapter" }
  | { kind: "verse"; verseStart: number; verseEnd?: number }
  | { kind: "continue"; verseEnd: number };

function parseSpokenNumber(phrase: string) {
  let value = 0;
  let current = 0;
  let sawNumber = false;
  for (const token of phrase.toLowerCase().split(/[\s-]+/)) {
    if (!token || token === "and") continue;
    if (token === "hundred") {
      current = Math.max(1, current) * 100;
      sawNumber = true;
      continue;
    }
    if (token === "thousand") {
      value += Math.max(1, current) * 1000;
      current = 0;
      sawNumber = true;
      continue;
    }
    const part = NUMBER_VALUES[token];
    if (!part) return null;
    current += part;
    sawNumber = true;
  }
  value += current;
  return sawNumber && value > 0 && value <= 999_999 ? value : null;
}

export function normalizeSpokenScriptureText(input: string) {
  return input
    .toLowerCase()
    .replace(/\bfirst\b/g, "1")
    .replace(/\bsecond\b/g, "2")
    .replace(/\bthird\b/g, "3")
    .replace(/\bzero\b/g, "0")
    .replace(/[–—]/g, "-")
    .replace(/[,;]/g, " ")
    .replace(/\b(\d+)\s+thousand\b/g, (_, digits: string) => {
      const value = Number(digits) * 1000;
      return Number.isSafeInteger(value) ? String(value) : digits;
    })
    .replace(/\s+/g, " ")
    .trim()
    .replace(SPOKEN_NUMBER_PATTERN, (phrase) => {
      const parsed = parseSpokenNumber(phrase);
      return parsed === null ? phrase : String(parsed);
    })
    .replace(/\s+/g, " ")
    .trim();
}

export function scriptureReference(
  book: string,
  chapter: number,
  verseStart: number,
  verseEnd?: number
) {
  const displayBook = book === "Psalms" ? "Psalm" : book;
  return `${displayBook} ${chapter}:${verseStart}${verseEnd && verseEnd !== verseStart ? `-${verseEnd}` : ""}`;
}

function hasMalformedReferenceTail(tail: string, strictConnector = false) {
  const trimmed = tail.trimStart();
  if (/^\.\d/.test(trimmed)) return true;

  const connector = /^(through|to|-)\s*/i.exec(trimmed);
  if (!connector) return false;
  if (strictConnector) return true;

  const remainder = trimmed.slice(connector[0].length).trimStart();
  if (!remainder) return true;
  return /^(?:[+-]?\d|negative\b|minus\b)/i.test(remainder);
}

export function hasExplicitScriptureAttempt(input: string) {
  const normalized = normalizeSpokenScriptureText(input);
  const aliases = Object.keys(BOOKS)
    .sort((a, b) => b.length - a.length)
    .map((name) => name.replace(/[.*+?^$\{\}()|[\]\\]/g, "\\$&"))
    .join("|");
  const pattern = new RegExp(
    String.raw`\b(?:${aliases})\s+(?:chapter\b|verse(?:s)?\b|[-+]?\d+\b|minus\b|negative\b)`,
    "i"
  );
  return pattern.test(normalized);
}

export function detectScriptureReferences(input: string): ScriptureDetection[] {
  const normalized = normalizeSpokenScriptureText(input);
  const aliases = Object.keys(BOOKS)
    .sort((a, b) => b.length - a.length)
    .map((name) => name.replace(/[.*+?^$\{\}()|[\]\\]/g, "\\$&"))
    .join("|");

  const pattern = new RegExp(
    String.raw`\b(${aliases})\s+(?:chapter\s+)?(\d+)(?![\w])(?:(?:\s*:\s*)|(?:\s+verse(?:s)?\s+)|(?:\s+))(\d+)(?![\w])(?:\s*(-|to|through)\s*(\d+)(?![\w]))?`,
    "gi"
  );

  const detections: ScriptureDetection[] = [];
  for (const match of normalized.matchAll(pattern)) {
    const book = BOOKS[match[1].toLowerCase()];
    if (!book) continue;
    const chapter = Number(match[2]);
    const verseStart = Number(match[3]);
    if (!Number.isInteger(chapter) || chapter < 1 || chapter > 150) continue;
    if (!Number.isInteger(verseStart) || verseStart < 1 || verseStart > 176) continue;

    const separator = match[4];
    const rawEnd = match[5];
    let verseEnd: number | undefined;
    if (separator) {
      if (!rawEnd || !/^\d+$/.test(rawEnd)) continue;
      verseEnd = Number(rawEnd);
      if (!Number.isInteger(verseEnd) || verseEnd < verseStart || verseEnd > 176) continue;
    }

    const matchEnd = (match.index ?? 0) + match[0].length;
    if (hasMalformedReferenceTail(normalized.slice(matchEnd))) continue;

    detections.push({
      book,
      chapter,
      verseStart,
      verseEnd,
      reference: scriptureReference(book, chapter, verseStart, verseEnd),
      confidence: 98,
    });
  }

  return detections;
}

export function detectContextualScriptureIntent(input: string): ContextualScriptureIntent | null {
  const normalized = normalizeSpokenScriptureText(input);
  if (/\bnext\s+verse\b/.test(normalized)) return { kind: "nextVerse" };
  if (/\b(?:previous|prior)\s+verse\b/.test(normalized)) return { kind: "previousVerse" };
  if (/\bnext\s+chapter\b/.test(normalized)) return { kind: "nextChapter" };

  const continuation = /\bcontinue(?:\s+(?:to|through))?\s+(?:verse\s+)?(\d+)(?![\w])/.exec(normalized);
  if (continuation) {
    const verseEnd = Number(continuation[1]);
    if (!Number.isInteger(verseEnd) || verseEnd < 1 || verseEnd > 176) return null;
    const matchEnd = (continuation.index ?? 0) + continuation[0].length;
    if (hasMalformedReferenceTail(normalized.slice(matchEnd), true)) return null;
    return { kind: "continue", verseEnd };
  }

  const verse = /\bverses?\s+(\d+)(?![\w])(?:\s*(-|to|through)\s*(\d+)(?![\w]))?/.exec(normalized);
  if (!verse) return null;
  const verseStart = Number(verse[1]);
  if (!Number.isInteger(verseStart) || verseStart < 1 || verseStart > 176) return null;

  const matchEnd = (verse.index ?? 0) + verse[0].length;
  if (hasMalformedReferenceTail(normalized.slice(matchEnd), true)) return null;

  const separator = verse[2];
  if (!separator) return { kind: "verse", verseStart };

  const rawEnd = verse[3];
  if (!rawEnd || !/^\d+$/.test(rawEnd)) return null;
  const verseEnd = Number(rawEnd);
  if (!Number.isInteger(verseEnd) || verseEnd < verseStart || verseEnd > 176) return null;
  return { kind: "verse", verseStart, verseEnd };
}

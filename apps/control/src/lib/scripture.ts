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

export type ScriptureDetection = {
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd?: number;
  reference: string;
  confidence: number;
};

export function detectScriptureReferences(input: string): ScriptureDetection[] {
  const normalized = input
    .toLowerCase()
    .replace(/\bfirst\b/g, "1")
    .replace(/\bsecond\b/g, "2")
    .replace(/\bthird\b/g, "3")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ");

  const aliases = Object.keys(BOOKS)
    .sort((a, b) => b.length - a.length)
    .map((name) => name.replace(/[.*+?^$\{\}()|[\]\\]/g, "\\$&"))
    .join("|");

  const pattern = new RegExp(
    "\\b(" + aliases + ")\\s+(?:chapter\\s+)?(\\d{1,3})(?:(?:\\s*:\\s*)|(?:\\s+verse(?:s)?\\s+))(\\d{1,3})(?:\\s*(?:-|to|through)\\s*(\\d{1,3}))?",
    "gi"
  );

  const detections: ScriptureDetection[] = [];
  for (const match of normalized.matchAll(pattern)) {
    const key = match[1].toLowerCase();
    const book = BOOKS[key];
    if (!book) continue;
    const chapter = Number(match[2]);
    const verseStart = Number(match[3]);
    const verseEnd = match[4] ? Number(match[4]) : undefined;
    if (chapter < 1 || chapter > 150 || verseStart < 1 || verseStart > 176) continue;

    const reference = book + " " + chapter + ":" + verseStart + (verseEnd ? "-" + verseEnd : "");
    detections.push({ book, chapter, verseStart, verseEnd, reference, confidence: 98 });
  }

  return Array.from(new Map(detections.map((item) => [item.reference, item])).values());
}

export type TranscriptReceiptInput = {
  serviceId?: string | null;
  startedAt: string;
  text: string;
  bibleVersion?: string | null;
  wireVersion?: number | null;
  language?: string | null;
  speakerId?: string | null;
  confidence?: number | null;
};

export function buildTranscriptReceiptPayload(payload: TranscriptReceiptInput) {
  const legacy = {
    serviceId: payload.serviceId ?? null,
    startedAt: payload.startedAt,
    text: payload.text,
    bibleVersion: payload.bibleVersion ?? null
  };

  if (payload.wireVersion !== 2) return legacy;

  return {
    ...legacy,
    wireVersion: 2,
    ...(payload.language != null ? { language: payload.language } : {}),
    ...(payload.speakerId != null ? { speakerId: payload.speakerId } : {}),
    ...(payload.confidence != null ? { confidence: payload.confidence } : {})
  };
}

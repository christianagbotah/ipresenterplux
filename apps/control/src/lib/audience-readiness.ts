export type AudienceDeliveryState = "ready" | "preparing" | "attention" | "waiting";
export type AudienceDeliveryTone = "healthy" | "working" | "warning" | "muted";
export type AudienceJobStatus = "pending" | "processing" | "succeeded" | "failed";

export type AudienceChannelReadinessInput = {
  serviceLive: boolean;
  channelMode: string;
  transcriptAvailable: boolean;
  translationStatus: AudienceJobStatus | null;
  synthesisStatus: AudienceJobStatus | null;
};

export type AudienceChannelReadiness = {
  state: AudienceDeliveryState;
  label: string;
  tone: AudienceDeliveryTone;
};

const waiting = (label: string): AudienceChannelReadiness => ({ state: "waiting", label, tone: "muted" });
const preparing = (label: string): AudienceChannelReadiness => ({ state: "preparing", label, tone: "working" });
const attention = (label: string): AudienceChannelReadiness => ({ state: "attention", label, tone: "warning" });
const ready = (label: string): AudienceChannelReadiness => ({ state: "ready", label, tone: "healthy" });

export function resolveAudienceChannelReadiness(input: AudienceChannelReadinessInput): AudienceChannelReadiness {
  if (!input.serviceLive) return waiting("Waiting for live service");

  if (input.channelMode === "original") return ready("Original audio ready");

  if (input.channelMode === "captions") {
    return input.transcriptAvailable ? ready("Captions ready") : waiting("Waiting for speech");
  }

  if (input.channelMode === "translation_text") {
    if (!input.transcriptAvailable || input.translationStatus === null) return waiting("Waiting for speech");
    if (input.translationStatus === "failed") return attention("Translation needs attention");
    if (input.translationStatus === "succeeded") return ready("Translated text ready");
    return preparing(input.translationStatus === "processing" ? "Translating text" : "Translation queued");
  }

  if (input.channelMode === "translation_audio") {
    if (!input.transcriptAvailable || input.translationStatus === null) return waiting("Waiting for speech");
    if (input.translationStatus === "failed" || input.synthesisStatus === "failed") return attention("Audio interpretation needs attention");
    if (input.translationStatus !== "succeeded") return preparing(input.translationStatus === "processing" ? "Translating speech" : "Translation queued");
    if (input.synthesisStatus === "succeeded") return ready("Translated audio ready");
    return preparing(input.synthesisStatus === "processing" ? "Synthesizing audio" : "Audio queued");
  }

  return attention("Unsupported language mode");
}

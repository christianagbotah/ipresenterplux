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

export type AudienceDeliveryFacet = {
  state: AudienceDeliveryState;
  label: string;
  tone: AudienceDeliveryTone;
};

export type AudienceChannelReadiness = AudienceDeliveryFacet & {
  text?: AudienceDeliveryFacet;
  voice?: AudienceDeliveryFacet;
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
    if (!input.transcriptAvailable || input.translationStatus === null) {
      return {
        ...waiting("Waiting for speech"),
        text: waiting("Waiting for translated text"),
        voice: waiting("Waiting for translated text")
      };
    }
    if (input.translationStatus === "failed") {
      return {
        ...attention("Translation needs attention"),
        text: attention("Translation needs attention"),
        voice: waiting("Waiting for translated text")
      };
    }
    if (input.translationStatus !== "succeeded") {
      const text = preparing(input.translationStatus === "processing" ? "Translating text" : "Translation queued");
      return {
        ...preparing(input.translationStatus === "processing" ? "Translating speech" : "Translation queued"),
        text,
        voice: waiting("Waiting for translated text")
      };
    }

    const text = ready("Translated text ready");
    if (input.synthesisStatus === "failed") {
      return {
        ...attention("Text ready · audio needs attention"),
        text,
        voice: attention("Audio needs attention")
      };
    }
    if (input.synthesisStatus === "succeeded") {
      return {
        ...ready("Text + audio ready"),
        text,
        voice: ready("Translated audio ready")
      };
    }
    const voice = preparing(input.synthesisStatus === "processing" ? "Synthesizing audio" : "Audio queued");
    return {
      ...preparing(input.synthesisStatus === "processing" ? "Text ready · synthesizing audio" : "Text ready · audio queued"),
      text,
      voice
    };
  }

  return attention("Unsupported language mode");
}

import type { PoolClient } from "pg";

export type SpeakerAttribution = {
  speakerId: string | null;
  speakerSource: "unknown" | "asr" | "operator_override";
};

export async function resolveSpeakerAttribution(
  client: PoolClient,
  serviceId: string,
  organizationId: string,
  providedSpeakerId: string | null | undefined
): Promise<SpeakerAttribution> {
  if (providedSpeakerId) {
    return { speakerId: providedSpeakerId, speakerSource: "asr" };
  }

  const override = await client.query<{ source_speaker_id: string }>(
    `select vp.source_speaker_id
     from service_speaker_overrides so
     join voice_profiles vp
       on vp.id=so.voice_profile_id and vp.organization_id=so.organization_id
     where so.service_id=$1 and so.organization_id=$2
       and vp.consent_status='consented'
       and vp.consented_at is not null
       and vp.revoked_at is null
       and vp.source_speaker_id is not null
       and length(btrim(vp.source_speaker_id)) > 0
     limit 1`,
    [serviceId, organizationId]
  );
  const speakerId = override.rows[0]?.source_speaker_id ?? null;
  return speakerId
    ? { speakerId, speakerSource: "operator_override" }
    : { speakerId: null, speakerSource: "unknown" };
}

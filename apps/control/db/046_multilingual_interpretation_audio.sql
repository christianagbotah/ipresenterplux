-- Complete the first-class interpreted-audio channel set without removing existing text/caption channels.
-- Existing organizations inherit audio for a supported language only when they already expose that language.

WITH supported(language_code, language_name) AS (
  VALUES
    ('en'::text, 'English · Interpretation'::text),
    ('fr'::text, 'French'::text),
    ('ak'::text, 'Twi / Akan'::text),
    ('ee'::text, 'Ewe'::text)
), organizations_with_language AS (
  SELECT DISTINCT lc.organization_id, lower(lc.language_code) AS language_code,
         bool_or(lc.enabled) AS enabled
  FROM language_channels lc
  WHERE lower(lc.language_code) IN ('en','fr','ak','ee')
  GROUP BY lc.organization_id, lower(lc.language_code)
)
INSERT INTO language_channels (organization_id, language_code, language_name, channel_mode, enabled)
SELECT owl.organization_id, supported.language_code, supported.language_name, 'translation_audio', owl.enabled
FROM organizations_with_language owl
JOIN supported ON supported.language_code=owl.language_code
ON CONFLICT (organization_id, language_code, channel_mode)
DO UPDATE SET
  language_name=excluded.language_name,
  enabled=language_channels.enabled OR excluded.enabled;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM language_channels source
    WHERE source.enabled=true
      AND lower(source.language_code) IN ('en','fr','ak','ee')
      AND NOT EXISTS (
        SELECT 1
        FROM language_channels audio
        WHERE audio.organization_id=source.organization_id
          AND lower(audio.language_code)=lower(source.language_code)
          AND audio.channel_mode='translation_audio'
          AND audio.enabled=true
      )
  ) THEN
    RAISE EXCEPTION 'multilingual_interpretation_audio_channel_invariant_failed';
  END IF;
END $$;

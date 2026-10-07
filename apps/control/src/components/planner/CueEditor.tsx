"use client";

import { CameraCueEditor } from "./editors/CameraCueEditor";
import { LowerThirdCueEditor } from "./editors/LowerThirdCueEditor";
import { MediaCueEditor, type MediaSourceOption } from "./editors/MediaCueEditor";
import { ScriptureCueEditor, type BibleVersionOption } from "./editors/ScriptureCueEditor";
import { SongCueEditor } from "./editors/SongCueEditor";
import { TextCueEditor } from "./editors/TextCueEditor";

export const plannerCueTypes = [
  "scripture",
  "song",
  "slide",
  "announcement",
  "lower_third",
  "media",
  "camera",
  "custom"
] as const;

export type PlannerCueType = (typeof plannerCueTypes)[number];

type Props = {
  itemType: PlannerCueType;
  value: Record<string, unknown>;
  bibleVersions: BibleVersionOption[];
  mediaSources: MediaSourceOption[];
  cameraSources: MediaSourceOption[];
  disabled?: boolean;
  onChange: (value: Record<string, unknown>) => void;
};

export function CueEditor({ itemType, value, bibleVersions, mediaSources, cameraSources, disabled = false, onChange }: Props) {
  if (itemType === "scripture") return <ScriptureCueEditor value={value} bibleVersions={bibleVersions} disabled={disabled} onChange={onChange} />;
  if (itemType === "song") return <SongCueEditor value={value} disabled={disabled} onChange={onChange} />;
  if (itemType === "slide" || itemType === "announcement" || itemType === "custom") {
    return <TextCueEditor itemType={itemType} value={value} disabled={disabled} onChange={onChange} />;
  }
  if (itemType === "lower_third") return <LowerThirdCueEditor value={value} disabled={disabled} onChange={onChange} />;
  if (itemType === "media") return <MediaCueEditor value={value} mediaSources={mediaSources} disabled={disabled} onChange={onChange} />;
  if (itemType === "camera") return <CameraCueEditor value={value} cameraSources={cameraSources} disabled={disabled} onChange={onChange} />;
  return null;
}

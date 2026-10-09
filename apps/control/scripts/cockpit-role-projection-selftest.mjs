#!/usr/bin/env node
import assert from "node:assert/strict";
import { projectCockpitForRole } from "../src/lib/cockpit/role-projection.ts";

const base = {
  organization: { id: "00000000-0000-4000-8000-000000000001", name: "Projection Church" },
  roles: [],
  service: { id:"00000000-0000-4000-8000-000000000002", title:"Sunday Live", status:"live", campusId:null, campusName:null, activeBibleVersion:"WEBP", aiEnabled:true, autoPreviewThreshold:90 },
  capabilities: { canLiveControl:false, canStreaming:false, canTranslations:false, canSettings:false, canViewPlanner:true, canPlanServices:false, canMedia:true, canCameras:true, canAIDirector:false, canArchive:true },
  program: { id:"program", source:"scripture_detection", contentType:"scripture", title:"John 3:16", state:"live", observedAt:"2099-01-01T10:00:00Z", detail:"WEBP" },
  preview: { id:"preview", source:"scripture_detection", contentType:"scripture", title:"Romans 8:28", state:"preview", observedAt:"2099-01-01T10:00:01Z", detail:"WEBP" },
  now: { speakerId:"pastor-main", speakerSource:"edge", transcriptText:"We know that all things work together for good", sourceLanguage:"en", asrConfidence:.97, observedAt:"2099-01-01T10:00:02Z", currentContent:null },
  next: [{ id:"next", source:"planned", targetType:"song", targetId:"song-1", title:"Amazing Grace", state:"queued", sortOrder:10, confidence:null, reason:"Planned service rundown", observedAt:"2099-01-01T10:00:00Z", freshUntil:null, actions:["open","pin"] }],
  attention: [{ id:"attn", severity:"warning", affectedCapability:"streaming", impact:"YouTube is degraded", containment:"Program and local audience remain healthy", recommendedAction:"Open Streaming", detailHref:"/streaming", observedAt:"2099-01-01T10:00:00Z", freshUntil:null, recoveryIntent:null }],
  systems: { edge:{freshness:"current",lastSeenAt:"2099-01-01T10:00:00Z",id:"edge",name:"Sanctuary Edge",status:"active"}, camera:{freshness:"current",lastSeenAt:"2099-01-01T10:00:00Z",count:2,activeName:"Lectern"}, audio:{freshness:"current",lastSeenAt:"2099-01-01T10:00:00Z",count:1,activeName:"Mixer"}, outputs:{total:2,enabled:2,healthy:1,degraded:1}, languages:{enabled:2,listeners:14}, audience:{listeners:14,serviceLive:true} },
  authority: { programMutation:"existing_domain_paths_only", edgeOwnsPhysicalTruth:true }
};

const producerModel = structuredClone(base);
producerModel.capabilities.canLiveControl = true;
producerModel.capabilities.canStreaming = true;
producerModel.capabilities.canAIDirector = true;
const producer = projectCockpitForRole(producerModel, ["presenter_operator"]);
assert.equal(producer.kind, "producer");
assert.equal(producer.showProgram, true);
assert.equal(producer.showPreview, true);
assert.equal(producer.showNext, true);
assert.equal(producer.showAttention, true);
assert.equal(producer.actions.canTake, true);
assert.equal(producer.actions.canClear, true);

const pastorModel = structuredClone(base);
pastorModel.capabilities.canLiveControl = true;
const pastor = projectCockpitForRole(pastorModel, ["pastor"]);
assert.equal(pastor.kind, "pastor_service_leader");
assert.equal(pastor.showEngineering, false);
assert.equal(pastor.showTranscript, false);
assert.equal(pastor.showNext, true);
assert.equal(pastor.actions.canPin, true);
assert.equal(pastor.actions.canTake, true, "projection may expose only live control already granted by server capabilities");

const interpreterModel = structuredClone(base);
interpreterModel.capabilities.canTranslations = true;
const interpreter = projectCockpitForRole(interpreterModel, ["translator"]);
assert.equal(interpreter.kind, "interpreter");
assert.equal(interpreter.showTranscript, true);
assert.equal(interpreter.showLanguages, true);
assert.equal(interpreter.actions.canTake, false);
assert.equal(interpreter.actions.canClear, false);

const mediaModel = structuredClone(base);
mediaModel.capabilities.canLiveControl = true;
mediaModel.capabilities.canStreaming = true;
const media = projectCockpitForRole(mediaModel, ["media_operator"]);
assert.equal(media.kind, "media_lead");
assert.equal(media.showMediaReadiness, true);
assert.equal(media.showCameraReadiness, true);
assert.equal(media.showNext, true);
assert.equal(media.actions.canTake, true);

const restricted = projectCockpitForRole(base, ["viewer"]);
assert.equal(restricted.kind, "restricted");
assert.equal(restricted.actions.canTake, false);
assert.equal(restricted.actions.canClear, false);
assert.equal(restricted.showEngineering, false);

const expiredProducerModel = structuredClone(producerModel);
expiredProducerModel.capabilities.canLiveControl = false;
expiredProducerModel.capabilities.canStreaming = false;
const refreshed = projectCockpitForRole(expiredProducerModel, ["presenter_operator"]);
assert.equal(refreshed.actions.canTake, false, "profile must never retain live authority after capability refresh");
assert.equal(refreshed.actions.canClear, false);

assert.notEqual(producer.kind, "audience");
assert.notEqual(pastor.kind, "audience");
console.log(JSON.stringify({ok:true,profiles:[producer.kind,pastor.kind,interpreter.kind,media.kind,restricted.kind],capabilityEscalation:false,audiencePrivateCockpit:false}));

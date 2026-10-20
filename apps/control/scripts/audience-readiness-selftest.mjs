#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveAudienceChannelReadiness } from "../src/lib/audience-readiness.ts";

const base={serviceLive:true,transcriptAvailable:true,translationStatus:null,synthesisStatus:null};

assert.deepEqual(resolveAudienceChannelReadiness({...base,channelMode:"original"}),{state:"ready",label:"Original audio ready",tone:"healthy"});
assert.deepEqual(resolveAudienceChannelReadiness({...base,channelMode:"captions"}),{state:"ready",label:"Captions ready",tone:"healthy"});
assert.equal(resolveAudienceChannelReadiness({...base,channelMode:"captions",transcriptAvailable:false}).state,"waiting");

assert.deepEqual(resolveAudienceChannelReadiness({...base,channelMode:"translation_text",translationStatus:"succeeded"}),{state:"ready",label:"Translated text ready",tone:"healthy"});
for(const status of ["pending","processing"]) assert.equal(resolveAudienceChannelReadiness({...base,channelMode:"translation_text",translationStatus:status}).state,"preparing");
assert.equal(resolveAudienceChannelReadiness({...base,channelMode:"translation_text",translationStatus:"failed"}).state,"attention");
assert.equal(resolveAudienceChannelReadiness({...base,channelMode:"translation_text",translationStatus:null}).state,"waiting");

assert.deepEqual(resolveAudienceChannelReadiness({...base,channelMode:"translation_audio",translationStatus:"succeeded",synthesisStatus:"succeeded"}),{state:"ready",label:"Translated audio ready",tone:"healthy"});
for(const synthesisStatus of ["pending","processing"]) assert.equal(resolveAudienceChannelReadiness({...base,channelMode:"translation_audio",translationStatus:"succeeded",synthesisStatus}).state,"preparing");
assert.equal(resolveAudienceChannelReadiness({...base,channelMode:"translation_audio",translationStatus:"failed",synthesisStatus:null}).state,"attention");
assert.equal(resolveAudienceChannelReadiness({...base,channelMode:"translation_audio",translationStatus:"succeeded",synthesisStatus:"failed"}).state,"attention");
assert.equal(resolveAudienceChannelReadiness({...base,channelMode:"translation_audio",translationStatus:null,synthesisStatus:null}).state,"waiting");

assert.equal(resolveAudienceChannelReadiness({...base,serviceLive:false,channelMode:"original"}).state,"waiting","non-live service must not claim delivery readiness");
assert.equal(resolveAudienceChannelReadiness({...base,channelMode:"unknown"}).state,"attention","unknown future modes must fail visibly rather than claim ready");

const source={
  audiencePage:await readFile(new URL("../src/app/audience/page.tsx",import.meta.url),"utf8"),
  studio:await readFile(new URL("../src/components/audience/AudienceStudio.tsx",import.meta.url),"utf8"),
  liveAudience:await readFile(new URL("../src/components/audience/LiveAudience.tsx",import.meta.url),"utf8"),
  liveAudio:await readFile(new URL("../src/components/audience/LiveTranslatedAudio.tsx",import.meta.url),"utf8"),
  livePage:await readFile(new URL("../src/app/live/page.tsx",import.meta.url),"utf8"),
  publicService:await readFile(new URL("../src/lib/public-audience-service.ts",import.meta.url),"utf8")
};
assert.match(source.audiencePage,/resolveAudienceChannelReadiness/,"Audience Studio data must resolve channel delivery readiness");
assert.match(source.audiencePage,/translation_status/,"Audience Studio query must inspect translation status");
assert.match(source.audiencePage,/synthesis_status/,"Audience Studio query must inspect translated-audio synthesis status");
assert.match(source.audiencePage,/AutoRefresh[^>]*intervalMs=\{10_000\}/,"Audience Studio must periodically expire silent listener sessions from its view");
for(const copy of ["Audience language demand","Active devices","Text / captions","Interpreted audio"]) assert.match(source.studio,new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")),`Audience Studio must expose ${copy}`);
assert.match(source.studio,/readiness\.label/,"Audience Studio must show channel readiness copy");
assert.match(source.publicService,/translation_status/,"Public audience payload must expose latest translation job status by channel");
assert.match(source.livePage,/translationStatus=/,"Live audience page must pass translation status to the client");
assert.match(source.liveAudience,/resolveAudienceChannelReadiness/,"Live audience language choices must use the shared readiness model");
assert.match(source.liveAudience,/readiness\.label/,"Live audience language choices must explain delivery readiness");
for(const [name,text] of [["AudienceStudio",source.studio],["LiveAudience",source.liveAudience],["LiveTranslatedAudio",source.liveAudio]]) assert.doesNotMatch(text,/text-\[(?:10|11)px\]/,`${name} operational copy must keep a 12px floor`);
assert.match(source.liveAudio,/min-h-11/,"translated-audio control must keep a 44px minimum touch target");

console.log(JSON.stringify({ok:true,states:["ready","preparing","attention","waiting"],audioRequiresSynthesis:true,nonLiveWaits:true,unknownFailsVisible:true,operatorDemand:true,publicReadiness:true,typographyFloor:"12px",touchFloor:44}));

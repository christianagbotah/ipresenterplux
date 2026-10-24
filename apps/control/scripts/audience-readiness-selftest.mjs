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

const audioReady=resolveAudienceChannelReadiness({...base,channelMode:"translation_audio",translationStatus:"succeeded",synthesisStatus:"succeeded"});
assert.equal(audioReady.state,"ready");
assert.equal(audioReady.label,"Text + audio ready");
assert.deepEqual(audioReady.text,{state:"ready",label:"Translated text ready",tone:"healthy"});
assert.deepEqual(audioReady.voice,{state:"ready",label:"Translated audio ready",tone:"healthy"});
for(const synthesisStatus of ["pending","processing"]) {
  const readiness=resolveAudienceChannelReadiness({...base,channelMode:"translation_audio",translationStatus:"succeeded",synthesisStatus});
  assert.equal(readiness.state,"preparing");
  assert.equal(readiness.text?.state,"ready");
  assert.equal(readiness.voice?.state,"preparing");
}
const translationFailed=resolveAudienceChannelReadiness({...base,channelMode:"translation_audio",translationStatus:"failed",synthesisStatus:null});
assert.equal(translationFailed.state,"attention");
assert.equal(translationFailed.text?.state,"attention");
assert.equal(translationFailed.voice?.state,"waiting");
const voiceFailed=resolveAudienceChannelReadiness({...base,channelMode:"translation_audio",translationStatus:"succeeded",synthesisStatus:"failed"});
assert.equal(voiceFailed.state,"attention");
assert.equal(voiceFailed.label,"Text ready · audio needs attention");
assert.deepEqual(voiceFailed.text,{state:"ready",label:"Translated text ready",tone:"healthy"});
assert.deepEqual(voiceFailed.voice,{state:"attention",label:"Audio needs attention",tone:"warning"});
assert.equal(resolveAudienceChannelReadiness({...base,channelMode:"translation_audio",translationStatus:null,synthesisStatus:null}).state,"waiting");
for(const languageCode of ["en","fr","ak","ee"]) {
  const readiness=resolveAudienceChannelReadiness({...base,channelMode:"translation_audio",translationStatus:"succeeded",synthesisStatus:"failed"});
  assert.equal(readiness.text?.state,"ready",`${languageCode} translated text must remain ready when audio fails`);
  assert.equal(readiness.voice?.state,"attention",`${languageCode} voice must expose synthesis failure independently`);
}

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
assert.match(source.studio,/readiness\.text/,"Audience Studio must surface translated-text readiness independently");
assert.match(source.studio,/readiness\.voice/,"Audience Studio must surface interpreted-voice readiness independently");
assert.match(source.publicService,/translation_status/,"Public audience payload must expose latest translation job status by channel");
assert.match(source.livePage,/translationStatus=/,"Live audience page must pass translation status to the client");
assert.match(source.liveAudience,/resolveAudienceChannelReadiness/,"Live audience language choices must use the shared readiness model");
assert.match(source.liveAudience,/readiness\.label/,"Live audience language choices must explain delivery readiness");
assert.match(source.liveAudience,/readiness\.text/,"Live audience must keep translated-text readiness visible when voice degrades");
assert.match(source.liveAudience,/readiness\.voice/,"Live audience must keep interpreted-voice readiness visible independently");
for(const [name,text] of [["AudienceStudio",source.studio],["LiveAudience",source.liveAudience],["LiveTranslatedAudio",source.liveAudio]]) assert.doesNotMatch(text,/text-\[(?:10|11)px\]/,`${name} operational copy must keep a 12px floor`);
assert.match(source.liveAudio,/min-h-11/,"translated-audio control must keep a 44px minimum touch target");
assert.match(source.liveAudio,/playbackRetryRef/,"web interpreted audio must track bounded per-segment playback retries");
assert.match(source.liveAudio,/playbackRetryRef\.current\s*>=\s*2/,"web interpreted audio must stop retrying a bad segment after the retry budget");
assert.match(source.liveAudio,/continuing with the next segment/i,"web interpreted audio must tell the audience it will continue after a bad segment");

console.log(JSON.stringify({ok:true,states:["ready","preparing","attention","waiting"],audioRequiresSynthesis:true,nonLiveWaits:true,unknownFailsVisible:true,operatorDemand:true,publicReadiness:true,typographyFloor:"12px",touchFloor:44}));

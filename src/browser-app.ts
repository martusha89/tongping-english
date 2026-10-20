export const BROWSER_APP_URI = "ui://tongping/shared-browser-v93";

export function browserAppPublicOrigin(): string {
  const value =
    process.env.TONGPING_PUBLIC_ORIGIN?.trim() ||
    `http://127.0.0.1:${process.env.TONGPING_PORT?.trim() || "45921"}`;
  return value.replace(/\/+$/, "");
}

export function browserAppUiDomain(): string | undefined {
  const value = process.env.TONGPING_UI_DOMAIN?.trim();
  return value || undefined;
}

export function renderBrowserApp(publicOrigin: string): string {
  const baseOrigin = publicOrigin.replace(/\/+$/, "");
  const assetUrl = `${baseOrigin}/assets/mcp-app-v2.js`;
  const brandIconUrl = `${baseOrigin}/assets/tongping-icon.png`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<style>
:root{
  color-scheme:light dark;
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text","Helvetica Neue",system-ui,sans-serif;
  --bg:rgba(248,248,251,.92);
  --surface:rgba(255,255,255,.78);
  --surface-strong:rgba(255,255,255,.94);
  --surface-soft:rgba(118,118,128,.08);
  --border:rgba(60,60,67,.12);
  --border-strong:rgba(60,60,67,.18);
  --text:#111114;
  --secondary:rgba(60,60,67,.66);
  --tertiary:rgba(60,60,67,.42);
  --accent:#ff4f93;
  --accent-soft:rgba(255,79,147,.12);
  --blue:#0a84ff;
  --danger:#ff3b30;
  --shadow:0 20px 60px rgba(28,28,30,.14),0 2px 10px rgba(28,28,30,.06);
}
@media(prefers-color-scheme:dark){
  :root{
    --bg:rgba(24,24,27,.94);
    --surface:rgba(44,44,48,.78);
    --surface-strong:rgba(48,48,52,.96);
    --surface-soft:rgba(235,235,245,.08);
    --border:rgba(235,235,245,.10);
    --border-strong:rgba(235,235,245,.16);
    --text:#f5f5f7;
    --secondary:rgba(235,235,245,.68);
    --tertiary:rgba(235,235,245,.42);
    --accent:#ff66a3;
    --accent-soft:rgba(255,102,163,.14);
    --shadow:0 22px 70px rgba(0,0,0,.42),0 1px 0 rgba(255,255,255,.03);
  }
}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:transparent;color:var(--text)}
button,input{font:inherit;color:inherit}
button{cursor:pointer;-webkit-tap-highlight-color:transparent}
button:disabled{cursor:default;opacity:.42}
#app{width:100%;min-width:0;padding:8px 8px max(8px,env(safe-area-inset-bottom,0px))}
.shell{
  overflow:hidden;
  border:1px solid var(--border);
  border-radius:26px;
  background:var(--bg);
  box-shadow:var(--shadow);
  backdrop-filter:saturate(180%) blur(28px);
  -webkit-backdrop-filter:saturate(180%) blur(28px);
}
.brandbar{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  padding:12px 12px 7px 14px;
}
.brandlockup{display:flex;align-items:center;gap:10px;min-width:0}
.brandIcon{width:34px;height:34px;flex:0 0 auto;border-radius:10px;object-fit:cover;filter:drop-shadow(0 5px 10px rgba(255,79,147,.18))}
.brandcopy{display:grid;gap:1px;min-width:0}
.brandcopy strong{font-size:15px;line-height:1.15;letter-spacing:-.02em;font-weight:680}
#title{max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--tertiary);font-size:10.5px;line-height:1.25;font-weight:500}
.brandActions{display:flex;align-items:center;gap:6px;min-width:0}
.badge,.version{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  height:26px;
  padding:0 9px;
  border-radius:999px;
  white-space:nowrap;
  font-size:10px;
  font-weight:650;
  letter-spacing:.035em;
}
.badge{
  border:1px solid var(--border);
  color:var(--secondary);
  background:var(--surface-soft);
}
.badge::before{
  content:"";
  width:6px;height:6px;border-radius:50%;
  margin-right:6px;background:#34c759;
  box-shadow:0 0 0 3px rgba(52,199,89,.10);
}
.badge.on::before{background:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.version{padding:0 5px;color:var(--tertiary);font-size:9px}
.toolbar{
  display:grid;
  grid-template-columns:72px 92px 74px minmax(0,1fr) 38px;
  grid-template-areas:"identity profile history address refresh";
  gap:6px;
  padding:7px 10px 10px;
}
#identity{grid-area:identity}
#profile{grid-area:profile}
.historyNav{grid-area:history;display:grid;grid-template-columns:1fr 1fr;gap:4px}
.addressWrap{grid-area:address;position:relative;display:flex;align-items:center;min-width:0}
#refresh{grid-area:refresh}
.toolbar input,.talk input,.humanInput{
  min-width:0;width:100%;height:38px;
  border:1px solid var(--border);
  border-radius:13px;
  background:var(--surface);
  color:var(--text);
  padding:0 11px;
  font-size:13px;
  outline:none;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.32);
  transition:border-color .18s ease,background .18s ease,box-shadow .18s ease;
}
.toolbar input:focus,.talk input:focus,.humanInput:focus{
  border-color:rgba(10,132,255,.32);
  background:var(--surface-strong);
  box-shadow:0 0 0 3px rgba(10,132,255,.08),inset 0 1px 0 rgba(255,255,255,.30);
}
#identity,#profile{
  text-align:center;
  font-size:11px;
  font-weight:650;
  letter-spacing:.02em;
  padding:0 7px;
}
#address{padding-right:42px}
button{
  min-height:38px;
  border:1px solid var(--border);
  border-radius:13px;
  background:var(--surface);
  color:var(--text);
  padding:0 11px;
  transition:transform .12s ease,background .15s ease,border-color .15s ease,opacity .15s ease;
}
button:active:not(:disabled){transform:scale(.96);background:var(--surface-soft)}
button.primary{
  color:#fff;
  background:linear-gradient(180deg,#ff6aa7,#ff4f93);
  border-color:rgba(255,79,147,.20);
  box-shadow:0 6px 16px rgba(255,79,147,.18),inset 0 1px 0 rgba(255,255,255,.24);
}
button.on{background:var(--accent-soft);border-color:rgba(255,79,147,.22);color:var(--accent)}
.iconButton{
  width:38px;height:38px;min-height:38px;padding:0;
  display:grid;place-items:center;border-radius:50%;
}
.iconButton svg,.historyNav svg,.buttonIcon,.addressGo svg,.roundAction svg,.sendGlyph{
  width:18px;height:18px;display:block;
  fill:none;stroke:currentColor;stroke-width:1.85;
  stroke-linecap:round;stroke-linejoin:round;
}
.historyNav button{width:35px;padding:0;display:grid;place-items:center}
.addressGo{
  position:absolute;right:4px;top:4px;
  width:30px;height:30px;min-height:30px;padding:0;
  border-radius:10px;
  display:grid;place-items:center;
  background:transparent;border-color:transparent;color:var(--blue);
}
.addressGo:active:not(:disabled){background:rgba(10,132,255,.10)}
.meta{
  display:none;
  margin:0 9px 7px;
  padding:7px 10px;
  border:1px solid rgba(255,59,48,.16);
  border-radius:11px;
  background:rgba(255,59,48,.06);
  font-size:10.5px;
}
.meta.on{display:flex}
#urlLabel{display:none}
#error{color:var(--danger);white-space:normal;font-weight:550;width:100%}
.viewportWrap{
  position:relative;
  margin:0 8px;
  background:var(--surface-soft);
  border:1px solid var(--border);
  border-radius:19px;
  display:grid;place-items:start center;
  min-height:0;height:auto;
  aspect-ratio:var(--remote-aspect,16 / 9);
  overflow:hidden;
  box-shadow:inset 0 0 0 .5px rgba(255,255,255,.05),0 6px 24px rgba(0,0,0,.08);
}
#frame,#liveCanvas,#mediaVideo{
  width:100%;height:100%;max-width:100%;max-height:100%;
  object-fit:contain;object-position:top center;
}
#frame{display:block;user-select:none;-webkit-user-drag:none;pointer-events:none}
#liveCanvas{display:none}
#mediaVideo{display:none;background:#000;pointer-events:none}
#mediaVideo.companionPlayback{pointer-events:auto}
.companionPrep{
  position:absolute;inset:0;z-index:8;
  display:none;place-items:center;
  padding:22px;
  background:
    radial-gradient(circle at 50% 40%,rgba(255,105,160,.17),transparent 32%),
    linear-gradient(180deg,rgba(24,24,28,.80),rgba(16,16,20,.94));
  color:#fff;text-align:center;
  backdrop-filter:blur(8px);
  -webkit-backdrop-filter:blur(8px);
}
.companionPrep.on{display:grid}
.companionPrepCard{
  width:min(290px,90%);
  display:grid;justify-items:center;gap:8px;
}
.companionCounter{
  font-size:13px;font-weight:760;letter-spacing:.01em;
  color:rgba(255,255,255,.94);
}
.companionTv{
  position:relative;width:80px;height:58px;
  border:2px solid rgba(255,255,255,.82);
  border-radius:18px;
  background:rgba(255,255,255,.08);
  box-shadow:0 12px 30px rgba(0,0,0,.20),inset 0 1px 0 rgba(255,255,255,.15);
}
.companionTv::before,.companionTv::after{
  content:"";position:absolute;top:-13px;width:22px;height:2px;
  border-radius:999px;background:rgba(255,255,255,.72);
  transform-origin:bottom center;
}
.companionTv::before{left:23px;transform:rotate(-38deg)}
.companionTv::after{right:23px;transform:rotate(38deg)}
.companionTvScreen{
  position:absolute;inset:7px;
  display:flex;align-items:center;justify-content:center;gap:6px;
  border-radius:12px;
  background:linear-gradient(145deg,rgba(255,132,177,.30),rgba(123,161,255,.18));
  overflow:hidden;
}
.companionDot{
  width:7px;height:7px;border-radius:50%;
  background:#fff;
  box-shadow:0 0 12px rgba(255,255,255,.35);
  animation:companionBounce 1.15s ease-in-out infinite;
}
.companionDot:nth-child(2){animation-delay:.16s}
.companionDot:nth-child(3){animation-delay:.32s}
@keyframes companionBounce{
  0%,60%,100%{transform:translateY(0);opacity:.58}
  30%{transform:translateY(-8px);opacity:1}
}
.companionPrepTitle{
  font-size:15px;font-weight:690;letter-spacing:.01em;
}
.companionPrepText{
  max-width:250px;
  font-size:11.5px;line-height:1.55;
  color:rgba(255,255,255,.68);
}
.companionProgress{
  width:min(220px,78%);height:4px;
  border-radius:999px;overflow:hidden;
  background:rgba(255,255,255,.12);
}
.companionProgressBar{
  height:100%;width:4%;
  border-radius:inherit;
  background:linear-gradient(90deg,#ff79ad,#9dafff);
  transition:width .45s ease;
}
.companionPrepActions{
  display:flex;align-items:center;justify-content:center;gap:8px;
  margin-top:2px;
}
.companionPrepActions button{
  min-height:34px;height:34px;
  padding:0 13px;border-radius:12px;
  border-color:rgba(255,255,255,.15);
  background:rgba(255,255,255,.10);
  color:#fff;font-size:11px;
}
#companionStart{
  display:none;
  background:rgba(255,255,255,.94);
  color:#24242a;
}
#companionStart.on{display:inline-flex}
.companionTimeline{
  display:none;margin:7px 9px 0;padding:8px 10px 7px;
  border:1px solid var(--border);border-radius:14px;background:var(--surface);
}
.companionTimeline.on{display:block}
.timelineMeta{
  display:grid;grid-template-columns:auto minmax(0,1fr) auto;
  align-items:center;gap:8px;margin-bottom:5px;
  font-size:10px;color:var(--tertiary);
}
.timelineMeta strong{color:var(--secondary);font-variant-numeric:tabular-nums}
.timelineHint{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center}
.timelineTrackWrap{position:relative;height:22px;display:flex;align-items:center}
.timelineBase,.timelineBuffered{
  position:absolute;left:0;right:0;height:4px;border-radius:999px;pointer-events:none;
}
.timelineBase{background:var(--surface-soft)}
.timelineBuffered{
  right:auto;width:0;
  background:linear-gradient(90deg,rgba(255,79,147,.68),rgba(10,132,255,.68));
}
#companionSeek{
  position:relative;z-index:2;width:100%;height:22px;margin:0;
  appearance:none;-webkit-appearance:none;background:transparent;accent-color:var(--accent);
}
#companionSeek::-webkit-slider-runnable-track{height:4px;background:transparent;border-radius:999px}
#companionSeek::-webkit-slider-thumb{
  -webkit-appearance:none;width:15px;height:15px;border-radius:50%;margin-top:-5.5px;
  border:2px solid var(--surface-strong);background:var(--accent);box-shadow:0 2px 7px rgba(0,0,0,.22);
}
#companionSeek:disabled{opacity:.45}
.modeBar{
  display:flex;align-items:center;justify-content:space-between;
  gap:8px;padding:8px 9px 0;
}
.modeStatus{
  display:flex;align-items:center;gap:7px;min-width:0;
  font-size:10.5px;color:var(--tertiary);
}
.modeStatusDot{
  width:7px;height:7px;border-radius:50%;
  background:#34c759;
  box-shadow:0 0 0 4px rgba(52,199,89,.10);
}
.modeStatus.companion .modeStatusDot{
  background:var(--accent);
  box-shadow:0 0 0 4px rgba(255,79,147,.10);
}
.modeStatus.preparing .modeStatusDot{
  background:#ff9f0a;
  box-shadow:0 0 0 4px rgba(255,159,10,.10);
  animation:modePulse 1.1s ease-in-out infinite;
}
@keyframes modePulse{50%{opacity:.35;transform:scale(.82)}}
/* The dot is a span: never let the generic span ellipsis rule or a crowded
   header squash it, and let it breathe so it reads as a live indicator. */
.modeStatus .modeStatusDot{flex:0 0 auto;display:block;overflow:visible;animation:modeBreath 2.4s ease-in-out infinite}
.modeStatus.preparing .modeStatusDot{animation:modePulse 1.1s ease-in-out infinite}
@keyframes modeBreath{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.55;transform:scale(.78)}}
@media(prefers-reduced-motion:reduce){.modeStatus .modeStatusDot{animation:none}}
.modeStatus strong{
  color:var(--secondary);font-weight:680;white-space:nowrap;
}
.modeStatus span{
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.modeActions{
  display:flex;align-items:center;gap:6px;flex:0 0 auto;
}
#companion{
  min-width:104px;height:34px;min-height:34px;
  border-radius:12px;padding:0 12px;
}
#showToAi{
  min-width:82px;height:34px;min-height:34px;
  border-radius:12px;padding:0 11px;
}
#watchTicket{
  min-width:74px;height:34px;min-height:34px;
  border-radius:12px;padding:0 10px;
}
#watchTicket.working svg{animation:showLookPulse .8s ease-in-out infinite}
.ticketOverlay{
  position:fixed;inset:0;z-index:40;
  display:none;align-items:flex-end;justify-content:center;
  padding:14px;
  background:rgba(10,10,14,.48);
  backdrop-filter:blur(10px);
  -webkit-backdrop-filter:blur(10px);
}
.ticketOverlay.on{display:flex}
.ticketSheet{
  width:min(680px,100%);
  max-height:min(88vh,760px);
  display:flex;flex-direction:column;
  border:1px solid rgba(255,255,255,.12);
  border-radius:22px;
  overflow:hidden;
  background:var(--surface);
  box-shadow:0 24px 80px rgba(0,0,0,.28);
}
.ticketSheetHead{
  min-height:50px;padding:8px 12px 8px 15px;
  display:flex;align-items:center;justify-content:space-between;gap:10px;
  border-bottom:1px solid var(--border);
}
.ticketSheetHead strong{font-size:13px;font-weight:720}
.ticketSheetHead span{font-size:10px;color:var(--tertiary)}
.ticketSheetClose{
  width:32px;height:32px;min-height:32px;padding:0;border-radius:50%;
  display:grid;place-items:center;font-size:18px;line-height:1;
}
.ticketSheetBody{
  overflow:auto;overscroll-behavior:contain;
  padding:12px;display:grid;gap:12px;
}
.ticketPreviewWrap{
  position:relative;overflow:hidden;
  border-radius:16px;background:#111;
  aspect-ratio:16/9;
  border:1px solid var(--border);
}
.ticketPreview{
  width:100%;height:100%;display:block;object-fit:contain;background:#111;
}
.ticketPreviewEmpty{
  position:absolute;inset:0;display:grid;place-items:center;
  padding:22px;text-align:center;color:rgba(255,255,255,.62);
  font-size:11px;line-height:1.55;
  background:linear-gradient(145deg,#17171c,#242431);
}
.ticketPreviewWrap.ready .ticketPreviewEmpty{display:none}
.ticketMetaRow{
  display:flex;align-items:center;justify-content:space-between;gap:8px;
  flex-wrap:wrap;
}
.ticketMetaText{
  min-width:0;display:grid;gap:2px;
}
.ticketMetaText strong{
  font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
.ticketMetaText span{font-size:9.5px;color:var(--tertiary)}
.collectionToggleRow{
  display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:10px 11px;border:1px solid var(--border);
  border-radius:14px;background:var(--surface-soft);
}
.collectionToggleText{min-width:0;display:grid;gap:2px}
.collectionToggleText strong{font-size:11px}
.collectionToggleText span{font-size:9.5px;color:var(--tertiary);line-height:1.35}
.collectionSwitch{
  position:relative;width:42px;height:24px;min-width:42px;
  border:0;padding:0;border-radius:999px;background:rgba(120,120,128,.28);
}
.collectionSwitch::after{
  content:"";position:absolute;top:3px;left:3px;
  width:18px;height:18px;border-radius:50%;background:#fff;
  box-shadow:0 1px 4px rgba(0,0,0,.2);
  transition:transform .2s ease;
}
.collectionSwitch.on{background:#34c759}
.collectionSwitch.on::after{transform:translateX(18px)}
.ticketActions{
  display:flex;gap:7px;align-items:center;flex-wrap:wrap;
}
.ticketActions button{
  min-height:36px;height:36px;border-radius:12px;padding:0 13px;
  font-size:10.5px;
}
.ticketActions .primary{flex:1 1 180px}
.ticketPrivacy{
  display:none;padding:11px 12px;border-radius:14px;
  border:1px solid rgba(255,159,10,.22);
  background:rgba(255,159,10,.08);
  gap:7px;
}
.ticketPrivacy.on{display:grid}
.ticketPrivacy strong{font-size:11px}
.ticketPrivacy p{
  margin:0;font-size:9.7px;line-height:1.5;color:var(--secondary);
}
.ticketPrivacyActions{display:flex;gap:7px;flex-wrap:wrap}
.ticketPrivacyActions button{min-height:34px;height:34px;border-radius:11px;padding:0 12px}
.ticketLibrary{
  display:none;gap:9px;
}
.ticketLibrary.on{display:grid}
.ticketLibraryToolbar{
  display:flex;align-items:center;justify-content:space-between;gap:8px;
}
.ticketLibraryToolbar strong{font-size:12px}
.ticketLibraryToolbar div{display:flex;gap:6px}
.ticketLibraryToolbar button{min-height:32px;height:32px;border-radius:10px;padding:0 10px;font-size:9.5px}
.ticketLibraryList{display:grid;gap:8px}
.ticketLibraryEmpty{
  padding:20px;border:1px dashed var(--border);border-radius:14px;
  text-align:center;font-size:10px;color:var(--tertiary);
}
.ticketLibraryItem{
  display:grid;grid-template-columns:108px minmax(0,1fr) auto;gap:9px;
  align-items:center;padding:7px;border:1px solid var(--border);
  border-radius:14px;background:var(--surface-soft);
}
.ticketLibraryThumb{
  width:108px;aspect-ratio:16/9;object-fit:cover;border-radius:9px;background:#111;
}
.ticketLibraryInfo{min-width:0;display:grid;gap:3px}
.ticketLibraryInfo strong{
  font-size:10.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
.ticketLibraryInfo span{font-size:9px;color:var(--tertiary)}
.ticketDelete{
  width:30px;height:30px;min-height:30px;padding:0;border-radius:50%;
  color:#ff3b30;
}
.ticketToast{
  min-height:18px;font-size:9.5px;color:var(--tertiary);
}
@media(max-width:520px){
  .companionPrep{padding:8px 12px}
  .companionPrepCard{width:min(300px,96%);gap:5px}
  .companionTv{width:58px;height:42px;border-radius:14px}
  .companionTv::before,.companionTv::after{top:-9px;width:16px}
  .companionTv::before{left:17px}.companionTv::after{right:17px}
  .companionTvScreen{inset:5px;border-radius:9px}
  .companionDot{width:5px;height:5px}
  .companionPrepTitle{font-size:13px}
  .companionPrepText{font-size:10px;line-height:1.35;max-width:270px}
  .companionCounter{font-size:12px}
  .companionPrepActions button{height:30px;min-height:30px;padding:0 10px}
  .modeActions{gap:4px}
  #showToAi,#watchTicket{min-width:34px;width:34px;padding:0}
  #showToAi .buttonLabel,#watchTicket .buttonLabel{display:none}
  #companion{min-width:86px;padding:0 9px}
  .ticketLibraryItem{grid-template-columns:88px minmax(0,1fr) auto}
  .ticketLibraryThumb{width:88px}
}

#showToAi.working svg{animation:showLookPulse .8s ease-in-out infinite}
@keyframes showLookPulse{50%{transform:scale(.82);opacity:.45}}
#companion.on{
  background:var(--accent-soft);
  border-color:rgba(255,79,147,.22);
  color:var(--accent);
}
.empty{
  position:absolute;inset:0;display:grid;place-items:center;
  color:var(--tertiary);font-size:12px;line-height:1.6;text-align:center;
  padding:30px;pointer-events:none;white-space:pre-line;
  background:
    radial-gradient(circle at 50% 42%,rgba(255,79,147,.08),transparent 34%),
    linear-gradient(180deg,var(--surface),var(--surface-soft));
}
.controls{
  display:grid;
  grid-template-columns:auto auto 38px 38px 38px minmax(120px,1fr) 38px;
  gap:6px;padding:9px 9px 7px;
}
.actionButton{
  display:inline-flex;align-items:center;justify-content:center;gap:7px;
  padding:0 13px;font-size:11.5px;font-weight:630;white-space:nowrap;
}
.actionButton .buttonIcon{width:16px;height:16px}
.roundAction{
  width:38px;height:38px;min-height:38px;padding:0;
  display:grid;place-items:center;border-radius:50%;
}
#sound .soundOff{display:none}
#sound:not(.on) .soundOn{display:none}
#sound:not(.on) .soundOff{display:block}
.keyButton{
  width:38px;height:38px;min-height:38px;padding:0;
  display:grid;place-items:center;border-radius:12px;
  font-size:11px;font-weight:650;color:var(--secondary);
}
#typeText{color:var(--blue)}
.remotePad{display:none;padding:0 9px 8px;gap:6px}
.remotePad.on{display:grid}
.touchMouse{
  overflow:hidden;border:1px solid var(--border);
  border-radius:18px;background:var(--surface);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.18);
}
.trackpad{
  height:138px;border:0;border-bottom:1px solid var(--border);
  background:linear-gradient(180deg,var(--surface),var(--surface-soft));
  display:grid;place-items:center;
  color:var(--tertiary);font-size:12px;touch-action:none;
  user-select:none;-webkit-user-select:none;position:relative;overflow:hidden;
}
.trackpad.active{background:var(--surface-soft)}
.trackLabel{display:grid;gap:3px;text-align:center;pointer-events:none}
.trackLabel strong{font-size:13px;font-weight:650;color:var(--secondary)}
.trackLabel span{font-size:10.5px;color:var(--tertiary)}
.trackDot{
  position:absolute;width:20px;height:20px;
  border:2px solid rgba(255,255,255,.92);border-radius:50%;
  transform:translate(-50%,-50%);pointer-events:none;display:none;
  box-shadow:0 2px 8px rgba(0,0,0,.24);
}
.trackDot.on{display:block}
.mouseKeys{display:grid;grid-template-columns:1fr 1fr}
.mouseKey{
  height:44px;min-height:44px;border:0;border-radius:0;background:transparent;
  touch-action:none;user-select:none;-webkit-user-select:none;
  color:var(--secondary);font-size:11px;
}
.mouseKey:first-child{border-right:1px solid var(--border)}
.mouseKey.pressed{background:var(--accent-soft);color:var(--accent)}
.nudgeStatus{
  font-size:10.5px;color:var(--tertiary);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 3px;
}
.talk{
  display:grid;grid-template-columns:38px 38px minmax(0,1fr) 38px;
  gap:6px;padding:0 9px 9px;
}
/* “Let Them See You”: their camera (with face effects) shown above the chat. */
#cameraToggle{width:38px;height:38px;min-height:38px;padding:0;display:grid;place-items:center;border-radius:50%}
#cameraToggle svg,.cameraTools svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.85;stroke-linecap:round;stroke-linejoin:round}
.cameraPanel{display:none;margin:8px 9px 0}
.shell.cameraOn .cameraPanel{display:block}
.cameraStage{position:relative;display:grid;place-items:center;border-radius:18px;overflow:hidden;background:#141014;min-height:120px}
#cameraCanvas{display:block;width:100%;height:auto;max-height:44dvh;object-fit:contain}
#cameraVideo{position:absolute;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none}
.cameraNote{position:absolute;left:10px;top:10px;max-width:calc(100% - 96px);padding:4px 9px;border-radius:999px;
  background:rgba(20,16,20,.55);color:#fff;font-size:10.5px;line-height:1.3;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
.cameraNote:empty{display:none}
.cameraTools{position:absolute;right:8px;top:8px;display:flex;gap:6px}
.cameraTools button{width:32px;height:32px;min-height:32px;padding:0;display:grid;place-items:center;border-radius:50%;
  color:#fff;background:rgba(20,16,20,.5);border-color:rgba(255,255,255,.25);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
.cameraTools svg{width:16px;height:16px}
.cameraLooked{position:absolute;left:50%;bottom:12px;transform:translate(-50%,8px);opacity:0;display:flex;align-items:center;gap:5px;
  padding:6px 12px;border-radius:999px;background:var(--accent);color:#fff;font-size:12px;font-weight:650;white-space:nowrap;
  transition:opacity .25s,transform .25s;pointer-events:none}
.cameraLooked.on{opacity:1;transform:translate(-50%,0)}
.cameraLooked svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
/* Chat-only hides the dock (and its “Show Everyone”), so sharing lives here too. */
.cameraBar{display:flex;align-items:center;gap:6px;padding-top:7px}
.cameraBar .cameraLooks{flex:1 1 auto;min-width:0;padding-top:0}
#cameraShare{flex:0 0 auto;height:30px;min-height:30px;padding:0 11px;border-radius:999px;display:flex;align-items:center;gap:4px;
  font-size:12px;font-weight:700;white-space:nowrap}
#cameraShare svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
#cameraShare.working svg{animation:showLookPulse .8s ease-in-out infinite}
.cameraLooks{display:flex;gap:6px;overflow-x:auto;padding:7px 1px 1px;scrollbar-width:none}
.cameraLooks::-webkit-scrollbar{display:none}
.cameraLooks button{flex:0 0 auto;height:28px;min-height:28px;padding:0 11px;border-radius:999px;font-size:11.5px;font-weight:650}
/* Hold-to-talk: mic/keyboard swap like a chat app. The transcript lands in
   the input for them to fix up; it is never sent automatically. */
#voiceToggle{width:38px;height:38px;min-height:38px;padding:0;display:grid;place-items:center;border-radius:50%}
#voiceToggle svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.85;stroke-linecap:round;stroke-linejoin:round}
#voiceToggle .voiceIconKeys,.talk.voice #voiceToggle .voiceIconMic{display:none}
.talk.voice #voiceToggle .voiceIconKeys{display:block}
#holdToTalk{display:none;height:38px;min-height:38px;border-radius:13px;font-size:13px;font-weight:650;letter-spacing:.08em;
  user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;touch-action:none}
.talk.voice #talkText{display:none}
.talk.voice #holdToTalk{display:block}
#holdToTalk.recording{color:#fff;background:var(--accent);border-color:transparent}
#holdToTalk.cancelling{color:#fff;background:#e5484d;border-color:transparent}
#holdToTalk.busy{opacity:.6}
.talk input{height:38px;border-radius:13px}
#talkSend{
  width:38px;height:38px;min-height:38px;padding:0;
  display:grid;place-items:center;border-radius:50%;
}
.chatPanel{
  margin:0 9px 7px;
  border:1px solid var(--border);border-radius:15px;
  background:var(--surface-soft);overflow:hidden;
}
.chatHead{
  height:28px;padding:0 10px;
  display:flex;align-items:center;justify-content:space-between;gap:8px;
  border-bottom:1px solid var(--border);
  color:var(--tertiary);font-size:9.5px;
}
.chatHead strong{color:var(--secondary);font-size:10.5px;font-weight:680}
/* v90: screen folded away, chat only. */
/* Folded, not stopped: the player stays in the page (iOS pauses media that
   is display:none), squashed to nothing so playback and the clock go on. */
.shell.screenCollapsed .viewportWrap{height:0;min-height:0;aspect-ratio:auto;margin:0;border:0;opacity:0;pointer-events:none;box-shadow:none}
.shell.screenCollapsed .dock,.shell.screenCollapsed #remoteDrawer{display:none}
.nowPlaying{display:none}
.shell.screenCollapsed .nowPlaying{display:flex;align-items:center;gap:7px;margin:8px 8px 0;padding:5px 6px 5px 10px;
  border:1px solid var(--border);border-radius:14px;background:var(--surface-soft);font-size:11px;color:var(--secondary);min-width:0}
.nowPlaying .npIcon{color:var(--accent);flex:0 0 auto;display:grid;place-items:center;width:14px;height:14px}
.nowPlaying .npIcon svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.nowPlaying .npIcon svg .fill{fill:currentColor;stroke:none}
.nowPlaying .npTitle{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text);font-weight:600}
.nowPlaying .npTime{flex:0 0 auto;font-variant-numeric:tabular-nums}
.nowPlaying button{flex:0 0 auto;height:22px;min-height:0;padding:0 9px;border-radius:999px;border:1px solid var(--border);
  background:var(--surface-strong);font-size:10.5px;font-weight:650;color:var(--accent)}
.shell.screenCollapsed .chatMessages{max-height:min(56vh,480px)}
#screenToggle.on{color:var(--accent);background:var(--accent-soft)}
.brandActions #screenToggle{display:flex;align-items:center;width:auto;padding:0 10px 0 8px;gap:4px;border-radius:999px;font-size:11px;font-weight:650;white-space:nowrap}
#screenToggle svg{flex:0 0 auto;width:16px;height:16px}
#screenToggle .screenIconChat{display:none}
#screenToggle:not(.on) .screenIconChat{display:block}
#screenToggle:not(.on) .screenIconScreen{display:none}
.chatMembers{display:flex;gap:4px;margin-left:auto;margin-right:4px}
.chatClear{flex:0 0 auto;height:17px;min-height:0;padding:0 7px;border-radius:999px;border:1px solid var(--border);
  background:transparent;font-size:9.5px;line-height:1;font-weight:620;color:var(--tertiary)}
.chatClear.armed{color:#fff;background:var(--danger,#e5484d);border-color:transparent}
.chatClear:disabled{opacity:.5}
.chatMember{display:inline-flex;align-items:center;gap:2px;height:17px;min-height:0;padding:0 6px;border-radius:999px;
  border:1px solid var(--border);background:transparent;font-size:9.5px;line-height:1;font-weight:620;color:var(--secondary)}
.chatMember.muted{opacity:.5}
.chatMember.muted .chatMemberName{text-decoration:line-through}
.chatMemberBell{display:grid;place-items:center}
.chatMemberBell svg{width:11px;height:11px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.chatMember[class*=" ai-claude"]{color:#c8603f}
.chatMember[class*=" ai-gpt"]{color:#4f9d83}
.chatRow.assistant[class*=" ai-claude"] .chatWho{color:#c8603f}
.chatRow.assistant[class*=" ai-gpt"] .chatWho{color:#4f9d83}
.chatNote{align-self:center;font-size:10.5px;color:var(--tertiary);padding:2px 0}
.chatMessages{
  min-height:46px;max-height:148px;overflow:auto;overscroll-behavior:contain;
  display:flex;flex-direction:column;gap:7px;padding:9px 8px 10px;
  scroll-behavior:smooth;
}
.chatEmpty{margin:auto;padding:8px 0;color:var(--tertiary);font-size:10.5px;text-align:center}
.chatEarlier{align-self:center;height:22px;min-height:0;padding:0 10px;border-radius:999px;border:1px solid var(--border);
  background:var(--surface-soft);color:var(--tertiary);font-size:10.5px}
.chatRow{display:flex;width:100%}
.chatRow.user{justify-content:flex-end}
.chatRow.assistant{justify-content:flex-start}
.chatBubble{
  max-width:84%;padding:7px 9px;border-radius:13px;
  font-size:10.8px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--text);
}
.chatRow.user .chatBubble{
  background:linear-gradient(180deg,#ff6aa7,#ff4f93);
  color:#fff;border-bottom-right-radius:5px;
}
.chatRow.assistant .chatBubble{
  background:var(--surface-strong);
  border:1px solid var(--border);border-bottom-left-radius:5px;
}
.chatWho{
  display:block;margin-bottom:3px;font-size:8.5px;font-weight:700;
  letter-spacing:.03em;opacity:.58;
}
.chatPendingBubble{display:inline-flex;align-items:center;gap:4px;min-width:48px}
.chatTypingDot{
  width:5px;height:5px;border-radius:50%;background:currentColor;opacity:.38;
  animation:chatTyping 1.1s ease-in-out infinite;
}
.chatTypingDot:nth-child(2){animation-delay:.15s}
.chatTypingDot:nth-child(3){animation-delay:.30s}
@keyframes chatTyping{
  0%,65%,100%{transform:translateY(0);opacity:.28}
  32%{transform:translateY(-3px);opacity:.75}
}
.shell.fullscreen .chatMessages{min-height:72px;max-height:min(28vh,240px)}
.hint{display:none}
.pointerDot{
  position:absolute;z-index:20;width:28px;height:28px;
  background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cpath d='M4 2v23l6-6 4 10 5-2-4-9h9z' fill='%23fff' stroke='%23111' stroke-width='2' stroke-linejoin='round'/%3E%3C/svg%3E") center/contain no-repeat;
  filter:drop-shadow(0 1px 2px rgba(0,0,0,.8));
  transform:translate(-2px,-2px);pointer-events:none;display:none;
}
.pointerDot.on{display:block}
.contextMirror{
  position:absolute;z-index:40;display:none;
  min-width:176px;max-width:min(270px,72vw);padding:6px;
  border:1px solid var(--border-strong);border-radius:16px;
  background:var(--surface-strong);
  box-shadow:0 16px 44px rgba(0,0,0,.22);
  backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);
}
.contextMirror.on{display:grid;gap:2px}
.contextMirror button{
  min-height:36px;border:0;border-radius:10px;background:transparent;text-align:left;padding:0 11px;
}
.contextMirror button:hover,.contextMirror button:active{background:var(--surface-soft)}
.contextMirror .sep{height:1px;background:var(--border);margin:3px 4px}
.contextMirror .muted{color:var(--tertiary)}
#refresh.working svg{animation:spin .8s linear infinite}
#refresh.done{color:#34c759}
@keyframes spin{to{transform:rotate(360deg)}}
.shell.fullscreen{
  border-radius:0;border-left:0;border-right:0;
  padding-top:max(env(safe-area-inset-top,0px),10px);
}
/* No close-button gutter in the header row: Claude and ChatGPT both put their
   close button in their own chrome above the card now, and the reserve only
   crowded the actions into the wordmark. */
.shell.fullscreen .viewportWrap{border-radius:16px}
/* v90: fill the host's fullscreen view and stay clear of host chrome
   (Claude overlays a close button/title on top and its composer below). */
.shell.fullscreen{
  display:flex;flex-direction:column;
  margin-top:var(--host-top,0px);margin-bottom:var(--host-bottom,0px);
  min-height:calc(100dvh - var(--host-top,0px) - var(--host-bottom,0px) - 16px);
}
.shell.fullscreen .viewportWrap{flex:1 1 auto;aspect-ratio:auto;min-height:38dvh;place-items:center}
.shell.fullscreen #frame,.shell.fullscreen #liveCanvas,.shell.fullscreen #mediaVideo{object-position:center}
/* Chat-only in fullscreen: the folded screen must not keep its 38dvh floor
   (that left a blank band under the header); the chat takes the height. */
.shell.fullscreen.screenCollapsed .viewportWrap{flex:0 0 0;height:0;min-height:0}
.shell.fullscreen.screenCollapsed .chatPanel{flex:1 1 auto;display:flex;flex-direction:column;min-height:0}
.shell.fullscreen.screenCollapsed .chatMessages{flex:1 1 auto;min-height:0;max-height:none}
@media(max-width:720px){
  #app{padding:4px 4px max(4px,env(safe-area-inset-bottom,0px))}
  .shell{border-radius:22px}
  .brandbar{padding:10px 9px 6px 11px}
  .brandIcon{width:31px;height:31px}
  .brandcopy strong{font-size:14px}
  .version{display:none}
  .toolbar{
    grid-template-columns:66px 82px 70px minmax(0,1fr) 36px;
    gap:5px;padding:6px 7px 8px;
  }
  .toolbar input{height:36px;border-radius:12px}
  .historyNav button,.iconButton{width:34px;height:36px;min-height:36px}
  .addressGo{top:3px;right:3px}
  .viewportWrap{margin:0 5px;border-radius:16px}
  .controls{
    grid-template-columns:auto auto 36px 36px minmax(0,1fr) 36px;
    gap:5px;padding:7px 6px 6px;
  }
  #esc{display:none}
  .roundAction,.keyButton{width:36px;height:36px;min-height:36px}
  .actionButton{padding:0 10px}
  .talk{grid-template-columns:36px 36px minmax(0,1fr) 36px;padding:0 6px 7px}
  #talkSend,#voiceToggle,#cameraToggle{width:36px;height:36px;min-height:36px}
  #holdToTalk{height:36px;min-height:36px}
}
@media(max-width:520px){
  .brandcopy #title{max-width:150px}
  .toolbar{
    grid-template-columns:62px 76px 66px 34px;
    grid-template-areas:
      "identity profile history refresh"
      "address address address address";
  }
  .addressWrap{margin-top:1px}
  .controls{
    grid-template-columns:1fr 1fr 36px 36px;
    grid-template-areas:
      "takeover login sound enter"
      "human human human type";
  }
  #takeover{grid-area:takeover}
  #localLogin{grid-area:login}
  #sound{grid-area:sound}
  #enter{grid-area:enter}
  #humanText{grid-area:human}
  #typeText{grid-area:type}
  .actionButton{min-width:0;padding:0 8px}
  .actionButton .buttonLabel{overflow:hidden;text-overflow:ellipsis}
  .meta{padding-left:10px;padding-right:10px}
}
/* ===== v89 skins: Morandi / candy colours under liquid glass ===== */
:root,:root[data-skin="candy"]{
  color-scheme:light;
  --bg:rgba(251,245,248,.66);
  --surface:rgba(255,255,255,.52);
  --surface-strong:rgba(255,255,255,.86);
  --surface-soft:rgba(255,255,255,.34);
  --border:rgba(255,255,255,.72);
  --border-strong:rgba(74,63,72,.14);
  --text:#4a3f48;
  --secondary:rgba(74,63,72,.74);
  --tertiary:rgba(74,63,72,.5);
  --accent:#d17f9f;
  --accent-soft:rgba(217,139,168,.18);
  --blue:#8c7fd4;
  --shadow:0 22px 60px -24px rgba(160,90,120,.35);
  --primary-grad:linear-gradient(135deg,#eda3be,#c9a2e3);
  --primary-glow:0 10px 26px -10px rgba(217,139,168,.8);
  --glass-inner:inset 0 1px 0 rgba(255,255,255,.85),inset 0 -1px 0 rgba(255,255,255,.2);
  --blob-1:#f2c3d2;--blob-2:#c5e6d8;--blob-3:#f5e2b2;--blob-4:#d8ccf1;
  --live:#6fb89a;
}
:root[data-skin="mist"]{
  color-scheme:light;
  --bg:rgba(240,230,228,.62);
  --surface:rgba(255,255,255,.5);--surface-strong:rgba(255,255,255,.84);--surface-soft:rgba(255,255,255,.3);
  --border:rgba(255,255,255,.7);--border-strong:rgba(61,51,54,.14);
  --text:#3d3336;--secondary:rgba(61,51,54,.74);--tertiary:rgba(61,51,54,.5);
  --accent:#b27f7b;--accent-soft:rgba(178,127,123,.18);--blue:#8a7fa8;
  --shadow:0 22px 60px -24px rgba(92,62,66,.35);
  --primary-grad:linear-gradient(135deg,#c6918c,#a8726f);
  --primary-glow:0 10px 26px -10px rgba(168,114,111,.75);
  --blob-1:#d6aea9;--blob-2:#b9c3ae;--blob-3:#c7bcd6;--blob-4:#efd3c4;
  --live:#7f9c85;
}
:root[data-skin="sage"]{
  color-scheme:light;
  --bg:rgba(226,231,224,.62);
  --surface:rgba(255,255,255,.48);--surface-strong:rgba(255,255,255,.82);--surface-soft:rgba(255,255,255,.28);
  --border:rgba(255,255,255,.66);--border-strong:rgba(47,56,51,.14);
  --text:#2f3833;--secondary:rgba(47,56,51,.74);--tertiary:rgba(47,56,51,.5);
  --accent:#6e8a7c;--accent-soft:rgba(110,138,124,.18);--blue:#6d8aa0;
  --shadow:0 22px 60px -24px rgba(52,70,62,.35);
  --primary-grad:linear-gradient(135deg,#82a092,#62806f);
  --primary-glow:0 10px 26px -10px rgba(98,128,111,.7);
  --blob-1:#a8b8a4;--blob-2:#9fb1bd;--blob-3:#cbc3b1;--blob-4:#b7c9c4;
  --live:#6e8a7c;
}
:root[data-skin="dusk"]{
  color-scheme:dark;
  --bg:rgba(42,40,48,.72);
  --surface:rgba(255,255,255,.1);--surface-strong:rgba(70,64,74,.94);--surface-soft:rgba(255,255,255,.06);
  --border:rgba(255,255,255,.16);--border-strong:rgba(255,255,255,.22);
  --text:#ece4e2;--secondary:rgba(236,228,226,.74);--tertiary:rgba(236,228,226,.5);
  --accent:#e0b7b1;--accent-soft:rgba(216,176,171,.18);--blue:#b8a9e0;
  --shadow:0 22px 70px -20px rgba(0,0,0,.7);
  --primary-grad:linear-gradient(135deg,#e0bbb5,#b98f8f);
  --primary-glow:0 10px 26px -10px rgba(216,176,171,.55);
  --glass-inner:inset 0 1px 0 rgba(255,255,255,.22),inset 0 -1px 0 rgba(255,255,255,.04);
  --blob-1:#6b5561;--blob-2:#4d5d5c;--blob-3:#5a5470;--blob-4:#7a6458;
  --live:#9fbfa8;
}
:root[data-skin="night"]{
  color-scheme:dark;
  --bg:rgba(14,15,19,.78);
  --surface:rgba(255,255,255,.07);--surface-strong:rgba(30,30,36,.96);--surface-soft:rgba(255,255,255,.04);
  --border:rgba(201,169,110,.28);--border-strong:rgba(201,169,110,.4);
  --text:#ede6d8;--secondary:rgba(237,230,216,.74);--tertiary:rgba(237,230,216,.5);
  --accent:#c9a96e;--accent-soft:rgba(201,169,110,.16);--blue:#d8c08c;
  --shadow:0 22px 70px -20px rgba(0,0,0,.85);
  --primary-grad:linear-gradient(135deg,#e3c68f,#b8955a);
  --primary-glow:0 10px 26px -10px rgba(201,169,110,.55);
  --glass-inner:inset 0 1px 0 rgba(232,211,166,.22),inset 0 -1px 0 rgba(0,0,0,.2);
  --blob-1:#3a3020;--blob-2:#1f2230;--blob-3:#2c2418;--blob-4:#242633;
  --live:#7fb3a0;
}
:root[data-skin="claude"]{
  color-scheme:light;
  --bg:rgba(250,245,237,.7);
  --surface:rgba(255,255,255,.54);--surface-strong:rgba(255,252,247,.9);--surface-soft:rgba(255,255,255,.32);
  --border:rgba(255,255,255,.72);--border-strong:rgba(61,47,40,.14);
  --text:#3d2f28;--secondary:rgba(61,47,40,.74);--tertiary:rgba(61,47,40,.5);
  --accent:#d97757;--accent-soft:rgba(217,119,87,.16);--blue:#c15f3c;
  --shadow:0 22px 60px -24px rgba(170,90,60,.34);
  --primary-grad:linear-gradient(135deg,#e8906f,#c8603f);
  --primary-glow:0 10px 26px -10px rgba(217,119,87,.75);
  --glass-inner:inset 0 1px 0 rgba(255,255,255,.85),inset 0 -1px 0 rgba(255,255,255,.2);
  --blob-1:#f2c1a8;--blob-2:#f6dfc8;--blob-3:#e9a58a;--blob-4:#fbe9d7;
  --live:#7fa37a;
}
.clawdMark{display:none;width:30px;flex:0 0 auto;filter:drop-shadow(0 4px 8px rgba(217,119,87,.35))}
.clawdMark svg{display:block;width:100%;height:auto}
:root[data-skin="claude"] .clawdMark{display:block;animation:clawdBob 2.8s ease-in-out infinite}
@keyframes clawdBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}
@media (prefers-reduced-motion:reduce){:root[data-skin="claude"] .clawdMark{animation:none}}
:root[data-skin="mint"]{
  color-scheme:dark;
  --bg:rgba(14,16,17,.86);
  --surface:rgba(255,255,255,.05);--surface-strong:rgba(24,27,28,.96);--surface-soft:rgba(255,255,255,.03);
  --border:rgba(236,232,222,.10);--border-strong:rgba(236,232,222,.18);
  --text:#ece8de;--secondary:rgba(236,232,222,.7);--tertiary:rgba(236,232,222,.45);
  --accent:#9fcfbd;--accent-soft:rgba(159,207,189,.12);--blue:#b9d8cc;
  --shadow:0 24px 70px -22px rgba(0,0,0,.85);
  --primary-grad:linear-gradient(180deg,#2c3031,#1a1d1e);
  --primary-glow:inset 0 1px 0 rgba(255,255,255,.08),0 0 0 1px rgba(236,232,222,.08),0 10px 24px -14px rgba(0,0,0,.9);
  --glass-inner:inset 0 1px 0 rgba(236,232,222,.10),inset 0 -1px 0 rgba(0,0,0,.35);
  --blob-1:#1b2a26;--blob-2:#141719;--blob-3:#1e2422;--blob-4:#16201d;
  --live:#8fd3b8;
}
:root[data-skin="mint"] .shellBlobs i{opacity:.5}
:root[data-skin="mint"] .viewportWrap{background:linear-gradient(180deg,rgba(12,14,15,.94),rgba(5,6,7,.97));
  box-shadow:inset 0 1px 0 rgba(236,232,222,.08),inset 0 0 0 1px rgba(236,232,222,.05),inset 0 -30px 60px -40px rgba(143,211,184,.12)}
:root[data-skin="mint"] .modeStatusDot{box-shadow:0 0 8px rgba(143,211,184,.75)}
:root[data-skin="mint"] button.primary{transition:box-shadow .25s ease,border-color .25s ease}
:root[data-skin="mint"] button.primary:hover,:root[data-skin="mint"] button.primary:active,:root[data-skin="mint"] button.primary.on{
  border-color:rgba(143,211,184,.32);box-shadow:var(--primary-glow),0 0 20px -6px rgba(143,211,184,.5)}
:root[data-skin="mint"] input:focus,:root[data-skin="mint"] textarea:focus{border-color:rgba(143,211,184,.35);box-shadow:0 0 0 3px rgba(143,211,184,.10);outline:none}
:root[data-skin="mint"] .empty{background:radial-gradient(circle at 50% 42%,rgba(143,211,184,.07),transparent 36%),linear-gradient(180deg,var(--surface),var(--surface-soft))}
:root[data-skin="mint"] .companionPrep{background:radial-gradient(circle at 50% 40%,rgba(143,211,184,.14),transparent 34%),linear-gradient(180deg,rgba(14,16,17,.84),rgba(8,9,10,.95))}
:root[data-skin="claude"] .empty{background:radial-gradient(circle at 50% 42%,rgba(217,119,87,.08),transparent 34%),linear-gradient(180deg,var(--surface),var(--surface-soft))}
:root[data-skin="claude"] .companionPrep{background:radial-gradient(circle at 50% 40%,rgba(217,119,87,.2),transparent 32%),linear-gradient(180deg,rgba(40,26,20,.82),rgba(26,18,14,.94))}
.mintMark{display:none;width:28px;flex:0 0 auto;filter:drop-shadow(0 0 6px rgba(143,211,184,.35))}
.mintMark svg{display:block;width:100%;height:auto}
:root[data-skin="mint"] .mintMark{display:block;animation:mintGlow 4.5s ease-in-out infinite}
@keyframes mintGlow{0%,100%{filter:drop-shadow(0 0 4px rgba(143,211,184,.25))}50%{filter:drop-shadow(0 0 9px rgba(143,211,184,.55))}}
@media (prefers-reduced-motion:reduce){:root[data-skin="mint"] .mintMark{animation:none}}
:root[data-skin="dusk"] .chatRow.user .chatBubble,:root[data-skin="night"] .chatRow.user .chatBubble,
:root[data-skin="dusk"] #companion,:root[data-skin="night"] #companion{color:#221c1e}

.shell{position:relative;isolation:isolate;background:var(--bg);border-color:var(--border);
  box-shadow:var(--glass-inner),var(--shadow);transition:background-color .5s ease}
.shellBlobs{position:absolute;inset:0;z-index:-1;overflow:hidden;border-radius:inherit;pointer-events:none}
.shellBlobs i{position:absolute;border-radius:50%;filter:blur(46px);opacity:.9;transition:background-color .8s ease;
  animation:blobDrift 28s ease-in-out infinite alternate}
.shellBlobs i:nth-child(1){width:70%;aspect-ratio:1;left:-22%;top:-12%;background:var(--blob-1)}
.shellBlobs i:nth-child(2){width:60%;aspect-ratio:1;right:-20%;top:18%;background:var(--blob-2);animation-duration:34s}
.shellBlobs i:nth-child(3){width:64%;aspect-ratio:1;left:4%;bottom:-18%;background:var(--blob-3);animation-duration:31s}
.shellBlobs i:nth-child(4){width:40%;aspect-ratio:1;right:6%;bottom:12%;background:var(--blob-4);animation-duration:25s}
@keyframes blobDrift{to{transform:translate(8%,6%) scale(1.08)}}
@media(prefers-reduced-motion:reduce){.shellBlobs i{animation:none}}

button{background:var(--surface);border-color:var(--border);box-shadow:var(--glass-inner);
  backdrop-filter:blur(14px) saturate(160%);-webkit-backdrop-filter:blur(14px) saturate(160%)}
button.primary,.chatRow.user .chatBubble{background:var(--primary-grad);border-color:transparent;color:#fff;box-shadow:var(--primary-glow)}
button.on{background:var(--accent-soft);border-color:var(--border);color:var(--accent)}
.toolbar input,.talk input,.humanInput,.menuRow input{background:var(--surface-soft);border-color:var(--border);
  backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}
.brandcopy strong{display:flex;align-items:baseline;gap:4px;font-weight:600}
.wordmark{font-family:"Didot","Bodoni 72","Songti SC",Georgia,serif;font-style:italic;font-size:19px;letter-spacing:.01em;color:var(--accent)}
.brandbar{position:relative;flex-wrap:nowrap}
.brandActions{gap:6px}
.brandActions .iconButton{width:34px;height:34px;min-height:34px}
.modeStatus{height:28px;padding:0 10px;border-radius:999px;border:1px solid var(--border);background:var(--surface);
  box-shadow:var(--glass-inner);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
.modeStatusDot{background:var(--live)}
.modeStatus #modeStatusText{display:none}
/* LIVE is tuned for clicking; a light one-time nudge toward Watch Together for video. */
.liveHint{position:absolute;left:50%;bottom:12px;transform:translateX(-50%);z-index:6;
  max-width:calc(100% - 32px);padding:6px 12px;border-radius:999px;
  background:var(--surface-strong);color:var(--text);font-size:11.5px;line-height:1.35;
  box-shadow:0 2px 10px rgba(0,0,0,.12);opacity:0;pointer-events:none;transition:opacity .25s ease}
.liveHint.on{opacity:1}
.modeStatus strong{font-size:10px;letter-spacing:.06em}

.menuSheet{position:absolute;right:10px;top:52px;z-index:30;width:min(280px,calc(100% - 20px));
  display:grid;gap:4px;padding:8px;border:1px solid var(--border);border-radius:20px;
  background:var(--surface-strong);box-shadow:var(--glass-inner),var(--shadow);
  backdrop-filter:blur(24px) saturate(170%);-webkit-backdrop-filter:blur(24px) saturate(170%)}
.menuSheet[hidden]{display:none}
.menuRow{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:10px;padding:5px 6px;
  font-size:11px;color:var(--secondary)}
.menuRow input{height:34px;min-width:0;width:100%;border:1px solid var(--border);border-radius:11px;padding:0 10px;font-size:12px}
.menuButtons{grid-template-columns:minmax(0,1fr) auto}
.menuButtons #localLogin{height:36px;min-height:36px;border-radius:12px}
.menuFoot{grid-template-columns:auto auto auto;justify-content:start}
.menuFoot .version{display:inline-flex}
.menuSkins{grid-template-columns:repeat(5,minmax(0,1fr));gap:6px}
.skinDot{height:34px;min-height:34px;padding:0;border-radius:12px;font-size:9.5px;display:grid;place-items:center}
.skinDot.on{outline:2px solid var(--accent);outline-offset:1px}
.skinToast{position:absolute;right:52px;top:48px;z-index:31;padding:5px 10px;border-radius:999px;font-size:11px;
  background:var(--surface-strong);border:1px solid var(--border);box-shadow:var(--shadow);opacity:0;
  transform:translateY(-4px);transition:opacity .25s ease,transform .25s ease;pointer-events:none}
.skinToast.on{opacity:1;transform:none}

.viewportWrap{border-color:var(--border);box-shadow:var(--glass-inner),0 14px 34px -18px rgba(0,0,0,.4);border-radius:22px}
.companionTimeline{margin:8px 9px 0;border-radius:16px;border-color:var(--border);box-shadow:var(--glass-inner);
  backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
.timelineBuffered{background:var(--primary-grad)}

.dock{display:flex;align-items:center;gap:8px;padding:12px 9px 4px}
.dock #companion{flex:1 1 auto;min-width:0;height:48px;min-height:48px;border-radius:999px;font-size:14px;font-weight:700;
  letter-spacing:.04em;color:#fff;background:var(--primary-grad);border-color:transparent;box-shadow:var(--primary-glow);
  position:relative;overflow:hidden}
.dock #companion::after{content:"";position:absolute;top:0;left:-60%;width:45%;height:100%;
  background:linear-gradient(100deg,transparent,rgba(255,255,255,.4),transparent);transform:skewX(-18deg);
  animation:primarySheen 6s ease-in-out infinite}
@keyframes primarySheen{0%,72%{left:-60%}100%{left:130%}}
@media(prefers-reduced-motion:reduce){.dock #companion::after{animation:none}}
.dock #companion .buttonIcon{fill:currentColor}
/* One slim row of equal pills, icon then caption: watching and chatting are
   the point, so the controls between them take as little height as possible
   (a bare eye/ticket glyph was guesswork, hence the captions). */
.dock{gap:6px;padding:8px 9px 2px}
.dock #companion,.dock #companionPause,.dock #showToAi,.dock #watchTicket{flex:1 1 auto;width:auto;min-width:0;height:36px;min-height:36px;
  padding:0 7px;border-radius:999px;display:flex;flex-direction:row;align-items:center;justify-content:center;gap:3px;
  font-size:12px;font-weight:650;letter-spacing:0}
.dock #companion .buttonLabel,.dock #companionPause .buttonLabel,.dock #showToAi .buttonLabel,.dock #watchTicket .buttonLabel{display:block;
  white-space:nowrap;line-height:1}
.dock #companion .buttonIcon,.dock #companionPause .buttonIcon,.dock #showToAi .buttonIcon,.dock #watchTicket .buttonIcon{flex:0 0 auto;width:15px;height:15px}
@media(max-width:520px){
  .dock #companion,.dock #companionPause,.dock #showToAi,.dock #watchTicket{
    padding:0 4px;gap:2px;font-size:10px
  }
  .dock #companion .buttonIcon,.dock #companionPause .buttonIcon,.dock #showToAi .buttonIcon,.dock #watchTicket .buttonIcon{
    width:12px;height:12px
  }
}
/* Build numbers are for us when debugging: keep them in the menu foot. */
.brandcopy #title{display:none}
.menuFoot .version{display:inline;font-size:10px;color:var(--tertiary);white-space:nowrap}
.timelineBase{background:color-mix(in srgb,var(--text) 12%,transparent)}
.dock #companionPause[hidden]{display:none}

.drawer{margin:8px 9px 0;border:1px solid var(--border);border-radius:20px;background:var(--surface-soft);
  box-shadow:var(--glass-inner);overflow:hidden}
.drawerToggle{width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px;
  border:0;border-radius:0;background:transparent;box-shadow:none;backdrop-filter:none;-webkit-backdrop-filter:none;
  padding:0 14px;min-height:44px}
.drawerToggle strong{font-size:12.5px;font-weight:700}
.drawerToggle span{display:inline-flex;align-items:center;gap:6px;font-size:10.5px;color:var(--tertiary)}
.drawerToggle svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2;transition:transform .25s ease}
.drawer.open .drawerToggle svg{transform:rotate(180deg)}
.drawerBody{display:none}
.drawer.open .drawerBody{display:block}
.drawer .toolbar{grid-template-columns:36px 36px minmax(0,1fr) 36px 36px;grid-template-areas:none;padding:2px 9px 8px;gap:6px}
.drawer .toolbar>*{grid-area:auto}
.drawer .historyNav{display:contents}
.drawer .historyNav button,.drawer .toolbar .iconButton{width:36px;height:36px;min-height:36px;border-radius:50%}
.bookmarks{display:flex;flex-wrap:wrap;gap:6px;padding:0 9px 8px}
.bookmarks:empty{display:none}
.bookmarkChip{display:inline-flex;align-items:center;gap:4px;max-width:100%;min-height:30px;height:30px;
  padding:0 4px 0 11px;border-radius:999px;font-size:11px}
.bookmarkChip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:150px}
.bookmarkChip b{width:22px;height:22px;display:grid;place-items:center;border-radius:50%;font-weight:500;
  color:var(--tertiary);font-size:13px}
#bookmarkAdd.on svg{fill:currentColor}
.drawer .controls{padding-top:2px}
.chatPanel{border-color:var(--border);background:var(--surface-soft);box-shadow:var(--glass-inner);border-radius:18px;margin-top:9px}
.chatRow.assistant .chatBubble{background:var(--surface-strong);border-color:var(--border)}
.talk input{border-radius:999px}
#holdToTalk{border-radius:999px;background:var(--surface-soft);border:1px solid var(--border);color:var(--secondary)}
#holdToTalk.recording{color:#fff;background:var(--accent);border-color:transparent}
#holdToTalk.cancelling{color:#fff;background:#e5484d;border-color:transparent}
@media(max-width:520px){
  .modeStatus{padding:0 8px}
  .brandcopy #title{max-width:120px}
  .drawer .toolbar{grid-template-columns:34px 34px minmax(0,1fr) 34px 34px}
}

/* v89: menu, paused overlay, drawer grid, ticket sheet above the host composer */
.menuSheet{display:flex;flex-direction:column;gap:12px;padding:12px}
.menuSheet[hidden]{display:none}
.menuGroup{display:flex;flex-direction:column;gap:8px}
.menuField{display:flex;align-items:center;gap:10px}
.menuField label,.menuLabel{flex:0 0 58px;font-size:11px;color:var(--tertiary);letter-spacing:.02em}
.menuField input{flex:1 1 auto;min-width:0;height:36px;border:1px solid var(--border);border-radius:12px;
  padding:0 12px;font-size:12.5px;text-align:left;background:var(--surface-soft)}
.menuActions{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.menuActions button{width:100%;height:40px;min-height:40px;border-radius:14px;padding:0 10px;
  display:inline-flex;align-items:center;justify-content:center;gap:6px;font-size:12px}
.menuActions .buttonIcon,.menuActions svg{width:16px;height:16px}
.menuSkins{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px}
.skinDot{height:auto;min-height:0;padding:8px 2px 7px;border-radius:14px;display:flex;flex-direction:column;
  align-items:center;gap:5px;font-size:10px;line-height:1.1}
.skinDot i{width:18px;height:18px;border-radius:50%;box-shadow:0 0 0 2px rgba(255,255,255,.7)}
.skinDot.on{outline:2px solid var(--accent);outline-offset:1px}
.menuFoot{display:flex;align-items:center;gap:8px;padding-top:10px;border-top:1px solid var(--border-strong)}
.menuSpacer{flex:1 1 auto}
.menuFoot .version{flex:0 1 132px;min-width:0;text-align:right;white-space:normal;line-height:1.2;font-size:9px}

.pausedOverlay{position:absolute;inset:0;z-index:7;display:grid;place-items:center;background:#000}
.pausedOverlay[hidden]{display:none}
.pausedOverlay img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;object-position:top center;
  filter:saturate(.85) brightness(.72)}
.pausedOverlay img:not([src]){display:none}
.pausedBadge{position:relative;display:flex;flex-direction:column;align-items:center;gap:4px;padding:14px 20px;
  border-radius:20px;color:#fff;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.3);
  backdrop-filter:blur(14px) saturate(150%);-webkit-backdrop-filter:blur(14px) saturate(150%);text-align:center}
.pausedBadge svg{width:28px;height:28px;fill:none;stroke:#fff;stroke-width:2.4;stroke-linecap:round}
.pausedBadge strong{font-size:14px;letter-spacing:.06em}
.pausedBadge span{font-size:10.5px;opacity:.8}

.drawer .toolbar #refresh{grid-area:auto}
.drawer .controls{grid-template-columns:minmax(0,1fr) 38px 38px 38px;
  grid-template-areas:"takeover sound enter esc" "human human human type"}
.drawer #esc{display:grid;grid-area:esc}
.drawer #takeover{grid-area:takeover}
.drawer #sound{grid-area:sound}
.drawer #enter{grid-area:enter}
.drawer #humanText{grid-area:human}
.drawer #typeText{grid-area:type}

.ticketOverlay{align-items:flex-start;padding:max(12px,env(safe-area-inset-top,0px)) 12px 150px}
.ticketSheet{max-height:calc(100vh - 170px)}

/* English-edition wordmark: real text remains crisp, accessible, and skin-aware. */
.brandcopy strong.wordmark{position:relative;display:block;width:auto;height:auto;margin:0;
  font-family:"Didot","Bodoni 72",Georgia,serif;font-size:25px;line-height:1;font-style:italic;
  font-weight:700;letter-spacing:-.035em;color:var(--accent);background:none;
  -webkit-mask:none;mask:none;
  filter:drop-shadow(0 2px 5px color-mix(in srgb,var(--accent) 30%,transparent))}
.brandcopy strong.wordmark::after{display:none}

/* v89: menu fixes — old grid-area names and a column flex-basis leaked in */
.menuActions #localLogin,.menuActions #fullscreen{grid-area:auto}
.menuGroup > .menuLabel{flex:none}

/* ticket v2: 3:1 stub preview */
.ticketPreviewWrap{aspect-ratio:3/1;background:transparent;border:0}
.ticketPreview{object-fit:contain;background:transparent}
.ticketActions #ticketDownload,.ticketActions #ticketReframe{flex:0 0 auto}


/* v89 ticket sheet polish */
.ticketSheet{background:var(--surface-strong);border-color:var(--border);box-shadow:var(--glass-inner),var(--shadow);
  backdrop-filter:blur(24px) saturate(170%);-webkit-backdrop-filter:blur(24px) saturate(170%)}
.ticketSheetHead{border-bottom-color:var(--border-strong)}
.ticketSheetHead strong{font-size:14px}
.ticketSheetHead span{margin-left:6px}
.ticketSheetBody{gap:10px;padding:12px 14px 14px}
.ticketPreviewWrap{border-radius:14px;box-shadow:0 12px 30px -16px rgba(0,0,0,.35)}
.ticketMetaRow{gap:2px}
.ticketMetaText strong{font-size:11px;font-weight:650;color:var(--secondary)}
.ticketMetaText span{font-size:9.5px}
.collectionToggleRow{padding:8px 12px;border-radius:14px;border-color:var(--border);background:var(--surface-soft)}
.collectionToggleText strong{font-size:11.5px}
.collectionToggleText span{font-size:9.5px}
.collectionSwitch{width:38px;min-width:38px;height:22px}
.collectionSwitch::after{width:16px;height:16px}
.collectionSwitch.on{background:var(--live)}
.collectionSwitch.on::after{transform:translateX(16px)}
.ticketActions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.ticketActions button{width:100%;height:38px;min-height:38px;border-radius:14px;padding:0 6px;font-size:11.5px}
.ticketToast{text-align:center;font-size:10px}

.chatPendingHint{display:block;margin-top:4px;font-size:10px;color:var(--tertiary)}
</style>
</head>
<body>
<div id="app">
  <div class="shell" id="shell">
    <div class="shellBlobs" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
    <div class="brandbar">
      <div class="brandlockup">
        <span class="mintMark" aria-hidden="true"><svg viewBox="0 0 13 13" shape-rendering="crispEdges"><g fill="#8fd3b8" opacity=".75"><rect x="6" y="0" width="1" height="1"/><rect x="6" y="12" width="1" height="1"/><rect x="0" y="6" width="1" height="1"/><rect x="12" y="6" width="1" height="1"/><rect x="2" y="2" width="1" height="1"/><rect x="10" y="2" width="1" height="1"/><rect x="2" y="10" width="1" height="1"/><rect x="10" y="10" width="1" height="1"/></g><g fill="#ece8de"><rect x="4" y="2" width="1" height="1"/><rect x="5" y="2" width="1" height="1"/><rect x="6" y="2" width="1" height="1"/><rect x="7" y="2" width="1" height="1"/><rect x="8" y="2" width="1" height="1"/><rect x="3" y="3" width="1" height="1"/><rect x="4" y="3" width="1" height="1"/><rect x="8" y="3" width="1" height="1"/><rect x="9" y="3" width="1" height="1"/><rect x="2" y="4" width="1" height="1"/><rect x="3" y="4" width="1" height="1"/><rect x="9" y="4" width="1" height="1"/><rect x="10" y="4" width="1" height="1"/><rect x="2" y="5" width="1" height="1"/><rect x="10" y="5" width="1" height="1"/><rect x="2" y="6" width="1" height="1"/><rect x="10" y="6" width="1" height="1"/><rect x="2" y="7" width="1" height="1"/><rect x="10" y="7" width="1" height="1"/><rect x="2" y="8" width="1" height="1"/><rect x="3" y="8" width="1" height="1"/><rect x="9" y="8" width="1" height="1"/><rect x="10" y="8" width="1" height="1"/><rect x="3" y="9" width="1" height="1"/><rect x="4" y="9" width="1" height="1"/><rect x="8" y="9" width="1" height="1"/><rect x="9" y="9" width="1" height="1"/><rect x="4" y="10" width="1" height="1"/><rect x="5" y="10" width="1" height="1"/><rect x="6" y="10" width="1" height="1"/><rect x="7" y="10" width="1" height="1"/><rect x="8" y="10" width="1" height="1"/></g></svg></span>
        <span class="clawdMark" aria-hidden="true"><svg viewBox="0 0 16 11" shape-rendering="crispEdges"><g fill="#d97757"><rect x="2" y="1" width="12" height="7"/><rect x="0" y="3" width="2" height="3"/><rect x="14" y="3" width="2" height="3"/><rect x="3" y="8" width="1" height="3"/><rect x="5" y="8" width="1" height="3"/><rect x="10" y="8" width="1" height="3"/><rect x="12" y="8" width="1" height="3"/></g><g fill="#2b1a14"><rect x="5" y="3" width="1" height="2"/><rect x="10" y="3" width="1" height="2"/></g></svg></span>
        <div class="brandcopy">
          <strong class="wordmark">TongPing</strong>
          <span id="title">App v93 · Worker —</span>
        </div>
      </div>
      <div class="brandActions">
        <div class="modeStatus" id="modeStatus">
        <span class="modeStatusDot"></span>
        <strong id="modeStatusTitle">LIVE</strong>
        <span id="modeStatusText">Live control view</span>
      </div>
        <button id="screenToggle" class="iconButton" type="button" aria-label="Collapse view" title="Collapse view; chat only" aria-pressed="false">
          <svg class="screenIconChat" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg>
          <svg class="screenIconScreen" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
          <span id="screenToggleLabel">Chat only</span>
        </button>
        <button id="skinToggle" class="iconButton" type="button" aria-label="Change theme" title="Change theme">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.9 1.8-1.8 0-1.2-1-1.6-1-2.7 0-1 .8-1.7 1.8-1.7H17a4 4 0 0 0 4-4c0-4.2-4-7.8-9-7.8z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="14.5" cy="7" r="1"/></svg>
        </button>
        <button id="menuToggle" class="iconButton" type="button" aria-label="More" title="More" aria-expanded="false">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/></svg>
        </button>
      </div>
      <div class="menuSheet" id="menuSheet" hidden>
        <div class="menuGroup">
          <div class="menuField"><label for="identity">Control identity</label><input id="identity" list="identityOptions" value="gpt.chat" aria-label="AI identity" title="Control identity">
      <datalist id="identityOptions"><option value="gpt.chat"><option value="claude.chat"><option value="claude.code"><option value="gpt.codex"><option value="gpt.work"></datalist></div>
          <div class="menuField"><label for="profile">Profile</label><input id="profile" list="profileOptions" value="default" aria-label="Browser profile" title="Browser profile">
      <datalist id="profileOptions"><option value="default"><option value="goofish"><option value="douyin"><option value="xiaohongshu"><option value="taobao"></datalist></div>
        </div>
        <div class="menuActions">
          <button id="localLogin" class="actionButton" title="Sign in manually with Chrome or Edge on your computer">
        <svg class="buttonIcon" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>
        </svg>
        <span class="buttonLabel" id="localLoginLabel">Local sign-in</span>
      </button>
          <button id="fullscreen" class="actionButton" aria-label="Fullscreen" title="Fullscreen">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/>
          </svg>
          <span class="buttonLabel">Fullscreen</span>
        </button>
        </div>
        <div class="menuGroup">
          <span class="menuLabel">Theme</span>
          <div class="menuSkins" id="menuSkins"></div>
        </div>
        <div class="menuFoot"><span class="menuLabel">Control</span><span class="badge" id="controlBadge">MODEL</span><span class="menuSpacer"></span><span class="version" id="appVersion">v93</span></div>
      </div>
      <div class="skinToast" id="skinToast" aria-live="polite"></div>
    </div>
    <div class="meta" id="meta">
      <span id="urlLabel">No page open yet</span>
      <span id="error"></span>
    </div>
    <div class="viewportWrap" id="viewportWrap">
      <img id="frame" alt="">
      <canvas id="liveCanvas" aria-label="Live browser view"></canvas>
      <div class="liveHint" id="liveHint" role="status" aria-live="polite"></div>
      <video id="mediaVideo" autoplay muted playsinline crossorigin="anonymous" aria-label="Buffered media view"></video>
      <div class="companionPrep" id="companionPrep" aria-live="polite">
        <div class="companionPrepCard">
          <div class="companionTv" aria-hidden="true">
            <div class="companionTvScreen">
              <span class="companionDot"></span>
              <span class="companionDot"></span>
              <span class="companionDot"></span>
            </div>
          </div>
          <div class="companionPrepTitle" id="companionPrepTitle">Building a short buffer…</div>
          <div class="companionPrepText" id="companionPrepText">Playback intentionally trails the computer briefly to keep audio and video in sync.</div>
          <div class="companionCounter" id="companionCounter">Buffered 0 / 20 sec</div>
          <div class="companionProgress" aria-hidden="true">
            <div class="companionProgressBar" id="companionProgressBar"></div>
          </div>
          <div class="companionPrepActions">
            <button id="companionStart" type="button">Start Watch Together</button>
            <button id="companionCancel" type="button">Back to LIVE</button>
          </div>
        </div>
      </div>
      <div class="pausedOverlay" id="pausedOverlay" hidden>
        <img id="pausedFrame" alt="">
        <div class="pausedBadge">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg>
          <strong>Paused</strong>
          <span>The computer is paused here too · Select to resume</span>
        </div>
      </div>
      <div class="pointerDot" id="pointerDot"></div>
      <div class="contextMirror" id="contextMirror" role="menu" aria-label="Context menu"></div>
      <div class="empty" id="empty">The remote browser appears here.<br>Enter a URL or ask ChatGPT / Claude to open a page.</div>
    </div>
    <div class="companionTimeline" id="companionTimeline">
      <div class="timelineMeta">
        <strong id="timelineCurrent">00:00</strong>
        <span class="timelineHint" id="timelineHint">Waiting for buffered timeline</span>
        <strong id="timelineDuration">--:--</strong>
      </div>
      <div class="timelineTrackWrap">
        <div class="timelineBase"></div>
        <div class="timelineBuffered" id="timelineBuffered"></div>
        <input id="companionSeek" type="range" min="0" max="1" value="0" step="0.1" disabled aria-label="Watch Together timeline">
      </div>
    </div>
    <div class="dock">
      <button id="companion" class="actionButton" title="Enter Watch Together mode">
          <svg class="buttonIcon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 5v14l11-7z"/>
          </svg>
          <span class="buttonLabel" id="companionLabel">Watch Together</span>
        </button>
      <button id="companionPause" class="actionButton" title="Pause Watch Together; video and recording pause on the computer too" hidden>
          <svg class="buttonIcon" viewBox="0 0 24 24" aria-hidden="true">
            <path id="companionPauseIcon" d="M8 5v14M16 5v14"/>
          </svg>
          <span class="buttonLabel" id="companionPauseLabel">Pause</span>
        </button>
      <button id="showToAi" class="actionButton" title="Share the frame you see with the AIs in the group">
          <svg class="buttonIcon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M2.8 12s3.4-5.4 9.2-5.4S21.2 12 21.2 12s-3.4 5.4-9.2 5.4S2.8 12 2.8 12z"/>
            <circle cx="12" cy="12" r="2.6"/>
          </svg>
          <span class="buttonLabel" id="showToAiLabel">Show Everyone</span>
        </button>
      <button id="watchTicket" class="actionButton" title="Create a watch-memory ticket">
          <svg class="buttonIcon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 6.5h16v4a2 2 0 0 0 0 3v4H4v-4a2 2 0 0 0 0-3z"/>
            <path d="M15.5 7v10"/>
          </svg>
          <span class="buttonLabel" id="watchTicketLabel">Ticket</span>
        </button>
    </div>
    <section class="drawer" id="remoteDrawer">
      <button class="drawerToggle" id="drawerToggle" type="button" aria-expanded="false">
        <strong>Remote</strong>
        <span>URL · Bookmarks · Take control · Type
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
        </span>
      </button>
      <div class="drawerBody" id="drawerBody">
        <div class="toolbar">
          <div class="historyNav">
        <button id="back" aria-label="Back" title="Back">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>
        </button>
        <button id="forward" aria-label="Forward" title="Forward">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>
        </button>
      </div>
          <div class="addressWrap">
        <input id="address" inputmode="url" autocapitalize="off" autocomplete="off" placeholder="Search or enter URL" aria-label="URL">
        <button id="open" class="addressGo" aria-label="Open URL" title="Open">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M14 7l5 5-5 5"/></svg>
        </button>
      </div>
          <button id="refresh" class="iconButton" aria-label="Refresh" title="Refresh">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6v5h-5"/><path d="M19 11a7.5 7.5 0 1 0 1 4"/></svg>
      </button>
          <button id="bookmarkAdd" class="iconButton" type="button" aria-label="Bookmark current URL" title="Bookmark current URL">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.8l2.5 5.1 5.6.8-4 3.9 1 5.6-5.1-2.7-5 2.7 1-5.6-4.1-3.9 5.6-.8z"/></svg>
          </button>
        </div>
        <div class="bookmarks" id="bookmarks" aria-label="Bookmarks"></div>
    <div class="controls">
      <button id="takeover" class="actionButton primary">
        <svg class="buttonIcon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8.5 11V7.6a1.5 1.5 0 0 1 3 0V11M11.5 10V6.4a1.5 1.5 0 0 1 3 0V11M14.5 10V7.4a1.5 1.5 0 0 1 3 0v5.4M8.5 10.2V9.1a1.5 1.5 0 0 0-3 0v5.3c0 4 2.8 6.6 6.7 6.6h1.2c4 0 6.1-2.7 6.1-6.4v-3.1"/>
        </svg>
        <span class="buttonLabel" id="takeoverLabel">Take control</span>
      </button>
      <button id="sound" class="roundAction" title="Remote webpage audio" aria-label="Sound">
        <svg class="soundOn" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M11 5L6.8 8.5H4v7h2.8L11 19z"/><path d="M15 9a4 4 0 0 1 0 6M17.5 6.5a7.5 7.5 0 0 1 0 11"/>
        </svg>
        <svg class="soundOff" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M11 5L6.8 8.5H4v7h2.8L11 19z"/><path d="M15.5 10l5 5M20.5 10l-5 5"/>
        </svg>
      </button>
      <button id="enter" class="keyButton" aria-label="Enter" title="Enter">↵</button>
      <button id="esc" class="keyButton" aria-label="Esc" title="Esc">esc</button>
      <input id="humanText" class="humanInput" autocomplete="off" placeholder="Type after taking control">
      <button id="typeText" class="roundAction" aria-label="Type" title="Type">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M7 10l5-5 5 5"/></svg>
      </button>
    </div>
    <div class="remotePad" id="remotePad">
      <div class="touchMouse" id="touchMouse">
        <div class="trackpad" id="trackpad">
          <span class="trackLabel">
            <strong>Trackpad</strong>
            <span>Move · Click · Double-click</span>
          </span>
          <span class="trackDot" id="trackDot"></span>
        </div>
        <div class="mouseKeys">
          <button class="mouseKey" id="leftMouse">Left</button>
          <button class="mouseKey" id="rightMouse">Right</button>
        </div>
      </div>
      <div class="nudgeStatus" id="nudgeStatus">Swipe to move · Tap to click · Hold lower left to drag</div>
    </div>
      </div>
    </section>
    <section class="cameraPanel" id="cameraPanel" aria-label="Let Them See You">
      <div class="cameraStage">
        <video id="cameraVideo" playsinline muted autoplay></video>
        <canvas id="cameraCanvas" aria-label="Your camera view"></canvas>
        <div class="cameraNote" id="cameraNote">Camera on · They can look when they want</div>
        <div class="cameraLooked" id="cameraLooked" aria-live="polite"></div>
        <div class="cameraTools">
          <button id="cameraFlip" type="button" aria-label="Flip camera" title="Flip camera">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9a8 8 0 0 1 14-3l2 2M20 15a8 8 0 0 1-14 3l-2-2"/><path d="M20 4v4h-4M4 20v-4h4"/></svg>
          </button>
          <button id="cameraClose" type="button" aria-label="Close camera" title="Close camera">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>
      </div>
      <div class="cameraBar">
        <div class="cameraLooks" id="cameraLooks"></div>
        <button id="cameraShare" class="primary" type="button" title="Share how you look now with the AIs in the group">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.8 12s3.4-5.4 9.2-5.4S21.2 12 21.2 12s-3.4 5.4-9.2 5.4S2.8 12 2.8 12z"/><circle cx="12" cy="12" r="2.6"/></svg>
          <span>Show them</span>
        </button>
      </div>
    </section>
    <div class="nowPlaying" id="nowPlaying">
      <span class="npIcon" id="npIcon"></span>
      <span class="npTitle" id="npTitle">Now playing</span>
      <span class="npTime" id="npTime"></span>
      <button id="npExpand" type="button">Expand</button>
    </div>
    <div class="chatPanel" id="chatPanel">
      <div class="chatHead">
        <strong>Group chat</strong>
        <span class="chatMembers" id="chatMembers"></span>
        <button class="chatClear" id="chatClear" type="button" title="Clear group chat">Clear</button>
        <span id="chatStatus">Me · Them</span>
      </div>
      <div class="chatMessages" id="chatMessages">
        <div class="chatEmpty">Messages from you and them appear here</div>
      </div>
    </div>
    <div class="talk" id="talk">
      <button id="cameraToggle" type="button" aria-label="Let Them See You" title="Let Them See You">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 8.5a2 2 0 0 1 2-2h2l1.6-2h5.8l1.6 2h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.6"/></svg>
      </button>
      <button id="voiceToggle" type="button" aria-label="Switch to hold-to-talk" title="Hold to talk">
        <svg class="voiceIconMic" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>
        <svg class="voiceIconKeys" viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M8 14h8"/></svg>
      </button>
      <input id="talkText" autocomplete="off" placeholder="Message the current AI…">
      <button id="holdToTalk" type="button" aria-label="Hold to talk">Hold to talk</button>
      <button id="talkSend" class="primary" aria-label="Send" title="Send">
        <svg class="sendGlyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M7 10l5-5 5 5"/></svg>
      </button>
    </div>
    <div class="hint">Sign-in state is stored in the actual Chromium profile. While in control, you can click, drag, and enter account details or verification codes. After returning control, ChatGPT or Claude continues on the same page. Browser auditing records actions and the number of manually entered characters, never their content.</div>
  </div>
  <div class="ticketOverlay" id="ticketOverlay">
    <section class="ticketSheet" aria-label="Watch Memory Ticket">
      <header class="ticketSheetHead">
        <div>
          <strong id="ticketSheetTitle">Watch Memory Ticket</strong>
          <span id="ticketSheetSub">A moment you actually watched</span>
        </div>
        <button class="ticketSheetClose" id="ticketClose" aria-label="Close">×</button>
      </header>
      <div class="ticketSheetBody">
        <div id="ticketCreateView">
          <div class="ticketPreviewWrap" id="ticketPreviewWrap">
            <img id="ticketPreview" class="ticketPreview" alt="Watch Memory Ticket preview">
            <div class="ticketPreviewEmpty" id="ticketPreviewEmpty">Select “Ticket” to create a fixed-format keepsake from the frame you are viewing.</div>
          </div>
          <div class="ticketMetaRow">
            <div class="ticketMetaText">
              <strong id="ticketMetaTitle">Not created yet</strong>
              <span id="ticketMetaDetail">Not saved by default</span>
            </div>
          </div>
          <div class="collectionToggleRow">
            <div class="collectionToggleText">
              <strong>Save to Watch Collection</strong>
              <span id="collectionToggleHint">Off by default. Enable it to save finished tickets and required details.</span>
            </div>
            <button id="collectionSwitch" class="collectionSwitch" aria-label="Save to Watch Collection" aria-pressed="false"></button>
          </div>
          <div class="ticketPrivacy" id="ticketPrivacy">
            <strong>Confirm before enabling collection mode</strong>
            <p>When enabled, a random collection ID stores the finished ticket, title, platform, watch time, and source link. Original video and separate screenshots are not saved. Content is not manually reviewed by default. You can disable this, delete individual tickets, or clear the collection anytime.</p>
            <div class="ticketPrivacyActions">
              <button id="collectionConsent" class="primary">Agree and enable</button>
              <button id="collectionConsentCancel">Not now</button>
            </div>
          </div>
          <div class="ticketActions">
            <button id="ticketDownload">Save image</button>
            <button id="ticketReframe">Choose another frame</button>
            <button id="ticketOpenLibrary">Watch Collection</button>
          </div>
          <div class="ticketToast" id="ticketToast"></div>
        </div>
        <div class="ticketLibrary" id="ticketLibrary">
          <div class="ticketLibraryToolbar">
            <strong>My Watch Collection</strong>
            <div>
              <button id="ticketLibraryBack">Back to ticket</button>
              <button id="ticketLibraryClear">Clear</button>
            </div>
          </div>
          <div class="ticketLibraryList" id="ticketLibraryList"></div>
        </div>
      </div>
    </section>
  </div>
</div>
<script type="module">
import { App, applyDocumentTheme, applyHostStyleVariables, applyHostFonts } from ${JSON.stringify(assetUrl)};

const $ = (id) => document.getElementById(id);
const app = new App(
  { name: "tongping-app", version: "0.4.0-wip" },
  { availableDisplayModes: ["inline", "fullscreen"] },
  { autoResize: true }
);

let connected = false;
let busy = false;
let stateTimer = null;
let frameTimer = null;
let chatTimer = null;
let chatAfterSeq = 0;
let chatPending = false;
// Room seq this card found on its first sync; older messages start folded.
let chatEarlierThroughSeq = -1;
let chatShowEarlier = false;
let chatPendingSince = 0;
let chatHintTimer = null;
const chatMessages = [];
// v90 group chat: identities the user has muted, as reported by the room.
const chatMuted = new Set();
const CHAT_MEMBERS = ["claude.chat", "gpt.chat"];
const chatMessageIds = new Set();
let showToAiBusy = false;
let watchTicketBusy = false;
let watchCollectionEnabled = false;
let watchCollectionId = "";
let watchCollectionLoaded = false;
let watchCollection = null;
let currentWatchTicket = null;
let ticketPrivacyPending = false;
let ticketClearConfirmUntil = 0;
let liveFailed = false;
let liveSuperseded = false;
let liveSocket = null;
let liveSocketUrl = "";
let liveRetryTimer = null;
let liveRetryCount = 0;
let liveImageErrors = 0;
let lastLivePacketAt = 0;
let liveStallRefreshAt = 0;
let pendingLivePacket = null;
let liveRenderScheduled = false;
let liveNewestCapturedAt = 0;
let liveRenderedCapturedAt = 0;
let liveRenderedAtMs = 0;
let liveCommandSeq = 0;
const liveCommandPending = new Map();
let audioEnabled = false;
let audioSocket = null;
let audioSocketUrl = "";
let audioRetryTimer = null;
let audioRetryCount = 0;
let audioContext = null;
let audioNextTime = 0;
let audioLastSequence = null;
let audioScheduledSources = new Set();
let audioOutputGain = null;
let audioSessionKeepAlive = null;
let audioPacketsReceived = 0;
let audioLastPcmRms = 0;
let audioLastCapturedAt = 0;
let audioSyncErrorMs = 0;
let audioStatusTimer = null;
const AUDIO_TARGET_AHEAD = 0.28;
const AUDIO_MIN_AHEAD = 0.08;
const AUDIO_MAX_AHEAD = 0.62;
const AUDIO_MAX_SMALL_GAP_PACKETS = 6;
const AV_SYNC_BASE_AHEAD = 0.08;
const AV_SYNC_MIN_AHEAD = 0.04;
const AV_SYNC_MAX_AHEAD = 1.20;
const AV_SYNC_MAX_FRAME_AGE_MS = 1800;
const AV_SYNC_HARD_RESET_MS = 280;
const AV_SYNC_NUDGE_PER_PACKET = 0.018;
let mediaSocket = null;
let mediaSocketUrl = "";
let mediaRetryTimer = null;
let mediaRetryCount = 0;
let mediaSessionBlocked = false;
let mediaModeActive = false;
let companionModeActive = false;
let companionPhase = "idle";
let companionDelaySeconds = 20;
let companionStartedAt = 0;
let companionReconnectTimer = null;
let companionProbeTimer = null;
let companionPlaybackStatusTimer = null;
let companionVideoStarted = false;
let companionPlaybackArmed = false;
let companionBufferedSeconds = 0;
let companionSourceAnchorPts = null;
let companionSourceAnchorDateMs = null;
let companionSourcePlaybackRate = 1;
let companionSourceDuration = null;
let companionSourceSamples = [];
let companionStreamId = "";
let companionBufferStartPts = null;
let companionBufferEndPts = null;
let companionSeekDragging = false;
let companionSeekPending = false;
let companionBufferingCheckTimer = null;
let companionLastProgressTime = 0;
let companionLastProgressAt = 0;
let companionLastRecoveryLoadAt = 0;
let companionLastUserMediaInteractionAt = 0;
let companionAutoResumeTimer = null;
// Set only by the viewer's own pause button. While true nothing may auto-play
// the companion video, and the PC source + recorder are held as well.
let companionUserPaused = false;
let companionCaptureIssue = "";
let mediaSource = null;
let mediaSourceUrl = "";
let mediaSourceBuffer = null;
let mediaSegmentQueue = [];
let mediaStreamId = "";
let mediaMimeType = "";
let mediaSourceOpening = false;
let mediaPlaybackStarted = false;
let pointerGesture = null;
let gestureReady = Promise.resolve();
let pendingMove = null;
let movePumpActive = false;
let gestureFrameTimer = null;
let remoteCursor = null;
let remoteHeld = false;
let trackGesture = null;
let leftPointerId = null;
let rightPointerId = null;
let lastPadTapAt = 0;
let lastPadTapPoint = null;
let moveCommandInFlight = false;
let pendingRemoteMove = null;
let contextMenuOpen = false;
let contextMenuTarget = null;
let contextMenuPoint = null;
let state = {
  identity: "gpt.chat",
  profile: "default",
  title: "",
  appUiBuild: "v93",
  workerBuild: "",
  url: "",
  takeover: false,
  viewport: { width: 0, height: 0 },
  mimeType: "image/png",
  frameUrl: "",
  liveUrl: "",
  audioUrl: "",
  mediaUrl: "",
  companionHlsUrl: "",
  chatUrl: "",
  watchCollectionUrl: "",
  watchCollectionWriteUrl: "",
  inputUrl: "",
  controlUrl: "",
  base64: "",
  externalLoginEnabled: false,
  externalLogin: {
    active: false,
    supported: false,
    processRunning: false,
    readyToResume: false,
    browser: "",
    startedAt: ""
  },
  displayMode: "inline"
};

// name.entry, mirroring src/identity-alias.ts: older bare names fold in.
const LEGACY_IDENTITIES = { claude: "claude.chat", gpt: "gpt.chat", codex: "gpt.codex" };
function normalizeIdentity(value) {
  const v = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9._-]{1,40}$/.test(v)) return "gpt.chat";
  if (LEGACY_IDENTITIES[v]) return LEGACY_IDENTITIES[v];
  const dashed = /^(claude|gpt)-(chat|code|cloud|codex|work)(-\\d+)?$/.exec(v);
  if (dashed) return dashed[1] + "." + dashed[2] + (dashed[3] || "");
  const terminal = /^claude-(?:opus|sonnet|fable|haiku)(-\\d+)?$/.exec(v);
  if (terminal) return "claude.code" + (terminal[1] || "");
  return v;
}
function normalizeProfile(value) {
  const v = String(value || "").trim();
  return /^[a-zA-Z0-9._-]{1,64}$/.test(v) ? v : "default";
}
function syncFields() {
  $("identity").value = state.identity;
  $("profile").value = state.profile;
  if (state.url && document.activeElement !== $("address")) $("address").value = state.url;
}
function setError(message) {
  const text = message ? String(message).slice(0, 180) : "";
  $("error").textContent = text;
  $("meta").classList.toggle("on", Boolean(text));
}
function stableSignedSocketTarget(rawUrl) {
  const value = String(rawUrl || "");
  if (!value) return "";
  try {
    const url = new URL(value);
    const profile = url.searchParams.get("profile") || "";
    const appBuild = url.searchParams.get("app_build") || "";
    return (
      url.origin +
      url.pathname +
      "?profile=" +
      encodeURIComponent(profile) +
      "&app_build=" +
      encodeURIComponent(appBuild)
    );
  } catch {
    return value
      .replace(/([?&])(exp|sig)=[^&]*/g, "$1")
      .replace(/[?&]+$/, "");
  }
}

function applyState(next) {
  if (!next || typeof next !== "object") return;
  const wasExternalLogin = Boolean(state.externalLogin && state.externalLogin.active);
  if (next.identity) state.identity = normalizeIdentity(next.identity);
  if (next.profile) state.profile = normalizeProfile(next.profile);
  if (typeof next.title === "string") state.title = next.title;
  if (typeof next.appUiBuild === "string") state.appUiBuild = next.appUiBuild;
  if (typeof next.workerBuild === "string") state.workerBuild = next.workerBuild;
  if (typeof next.url === "string") state.url = next.url;
  if (typeof next.takeover === "boolean") state.takeover = next.takeover;
  if (typeof next.userName === "string") state.userName = next.userName.slice(0, 40);
  if (typeof next.aiName === "string") state.aiName = next.aiName.slice(0, 24);
  if (typeof next.externalLoginEnabled === "boolean") {
    state.externalLoginEnabled = next.externalLoginEnabled;
  }
  if (next.externalLogin && typeof next.externalLogin === "object") {
    state.externalLogin = {
      active: next.externalLogin.active === true,
      supported: next.externalLogin.supported !== false,
      processRunning: next.externalLogin.processRunning === true,
      readyToResume: next.externalLogin.readyToResume === true,
      browser:
        typeof next.externalLogin.browser === "string"
          ? next.externalLogin.browser
          : "",
      startedAt:
        typeof next.externalLogin.startedAt === "string"
          ? next.externalLogin.startedAt
          : ""
    };
  }
  if (next.viewport && typeof next.viewport === "object") {
    state.viewport = {
      width: Number(next.viewport.width || 0),
      height: Number(next.viewport.height || 0)
    };
    if (state.viewport.width > 0 && state.viewport.height > 0) {
      $("shell").style.setProperty(
        "--remote-aspect",
        state.viewport.width + " / " + state.viewport.height
      );
    }
  }
  if (typeof next.mimeType === "string") state.mimeType = next.mimeType;
  if (typeof next.frameUrl === "string") state.frameUrl = next.frameUrl;
  if (typeof next.liveUrl === "string") {
    // A re-signed ticket for the same lane is not a new target: keep it for
    // the next reconnect without dropping a healthy live socket.
    const changed =
      stableSignedSocketTarget(next.liveUrl) !==
      stableSignedSocketTarget(state.liveUrl);
    if (changed) {
      state.liveUrl = next.liveUrl;
      liveFailed = false;
      liveSuperseded = false;
      liveRetryCount = 0;

      if (
        liveSocket &&
        liveSocketUrl &&
        liveSocketUrl !== next.liveUrl
      ) {
        closeLiveSocket(false);
      }

      queueMicrotask(() => ensureLiveSocket());
    } else if (!liveSuperseded) {
      const rotated = next.liveUrl !== state.liveUrl;
      state.liveUrl = next.liveUrl;
      // A live lane that gave up on an expired ticket retries once it has
      // a freshly signed one.
      if (rotated && liveFailed) {
        liveFailed = false;
        liveRetryCount = 0;
        queueMicrotask(() => ensureLiveSocket());
      }
    }
  }
  if (typeof next.audioUrl === "string") {
    const audioActive =
      audioSocket &&
      (audioSocket.readyState === WebSocket.OPEN ||
       audioSocket.readyState === WebSocket.CONNECTING);
    if (!audioActive) {
      state.audioUrl = next.audioUrl;
    }
  }
  if (typeof next.companionHlsUrl === "string") {
    state.companionHlsUrl = next.companionHlsUrl;
  }
  if (typeof next.chatUrl === "string") {
    const changed =
      stableSignedSocketTarget(next.chatUrl) !==
      stableSignedSocketTarget(state.chatUrl);
    state.chatUrl = next.chatUrl;
    if (changed) queueMicrotask(() => startChatSync());
  }
  if (typeof next.watchCollectionUrl === "string") {
    const changed =
      stableSignedSocketTarget(next.watchCollectionUrl) !==
      stableSignedSocketTarget(state.watchCollectionUrl);
    state.watchCollectionUrl = next.watchCollectionUrl;
    if (changed) {
      queueMicrotask(() => syncWatchCollectionFromServer());
    }
  }
  if (typeof next.watchCollectionWriteUrl === "string") {
    state.watchCollectionWriteUrl = next.watchCollectionWriteUrl;
  }
  if (typeof next.mediaUrl === "string") {
    const targetChanged =
      stableSignedSocketTarget(next.mediaUrl) !==
      stableSignedSocketTarget(state.mediaUrl);
    // Always retain the newest signed URL so a later reconnect gets fresh
    // authority, but do not tear down a healthy media socket merely because
    // exp/sig rotated during normal App polling.
    state.mediaUrl = next.mediaUrl;
    if (targetChanged) {
      closeMediaSocket(!companionModeActive, true);
      mediaRetryCount = 0;
    }
    if (
      companionModeActive &&
      !state.takeover &&
      !state.externalLogin?.active
    ) {
      queueMicrotask(() => ensureMediaSocket());
    }
  }
  if (typeof next.inputUrl === "string") state.inputUrl = next.inputUrl;
  if (typeof next.controlUrl === "string") state.controlUrl = next.controlUrl;
  if (typeof next.base64 === "string") state.base64 = next.base64;
  render();

  // The worker hands a slider/login wall to local Chrome and takes the
  // profile back on its own; the card only learns that from state. Poll fast
  // while handed off, and reopen live the moment the profile is back.
  const isExternalLogin = Boolean(state.externalLogin && state.externalLogin.active);
  if (wasExternalLogin !== isExternalLogin) {
    queueMicrotask(() => {
      if (!isExternalLogin) {
        liveFailed = false;
        liveSuperseded = false;
        liveRetryCount = 0;
        liveImageErrors = 0;
        refreshImage();
        scheduleLiveFrameResync();
      }
      startPolling();
    });
  }
}
// LIVE is tuned for click response, not smooth video. On a video page in
// LIVE, say once (per page) that Watch Together plays it smoothly.
const VIDEO_PAGE_PATTERNS = [
  /bilibili\\.com\\/(video|bangumi\\/play)\\//i,
  /douyin\\.com\\/(video\\/|jingxuan|.*[?&]modal_id=)/i,
  /youtube\\.com\\/(watch|shorts\\/)/i,
  /youtu\\.be\\//i,
  /v\\.qq\\.com\\/x\\//i,
  /iqiyi\\.com\\/v_/i,
  /youku\\.com\\/v_show/i,
  /netflix\\.com\\/watch/i,
  /kuaishou\\.com\\/(short-video|video)/i,
];
let liveHintShownFor = "";
let liveHintTimer = null;
function maybeShowLiveVideoHint() {
  const url = String(state.url || "");
  const onVideo = VIDEO_PAGE_PATTERNS.some((pattern) => pattern.test(url));
  if (!onVideo || companionModeActive || state.externalLogin?.active || !connected) return;
  const page = url.replace(/[#].*$/, "");
  if (page === liveHintShownFor) return;
  liveHintShownFor = page;
  const hint = $("liveHint");
  hint.textContent = "Live view prioritizes responsive clicks; use “Watch Together” for smoother video";
  hint.classList.add("on");
  if (liveHintTimer) clearTimeout(liveHintTimer);
  liveHintTimer = setTimeout(() => hint.classList.remove("on"), 6000);
}

function render() {
  if (typeof renderChromeExtras === "function") renderChromeExtras();
  maybeShowLiveVideoHint();
  syncFields();
  const externalActive = Boolean(state.externalLogin && state.externalLogin.active);
  $("controlBadge").textContent =
    externalActive ? "LOCAL LOGIN" : state.takeover ? "HUMAN" : "MODEL";
  $("controlBadge").classList.toggle("on", state.takeover || externalActive);
  $("takeoverLabel").textContent = state.takeover ? "Return to AI" : "Take control";
  $("takeover").classList.toggle("on", state.takeover);
  $("takeover").disabled = externalActive;

  $("localLogin").disabled =
    !externalActive && !state.externalLoginEnabled;
  $("localLogin").classList.toggle("on", externalActive);
  $("localLoginLabel").textContent = externalActive
    ? "Signed in — reconnect"
    : "Local sign-in";
  $("localLogin").title = externalActive
    ? "Finish signing in on your computer, close the local Chrome/Edge window, then reconnect here"
    : state.externalLoginEnabled
      ? "Sign in manually with Chrome or Edge on your computer"
      : "Requires Windows Worker v28+";

  const companionPreparing =
    companionModeActive &&
    (companionPhase === "preparing" ||
     companionPhase === "ready" ||
     companionPhase === "buffering");
  $("watchTicket").classList.toggle("working", watchTicketBusy);
  $("watchTicketLabel").textContent =
    watchTicketBusy ? "Creating…" : "Ticket";
  $("watchTicket").disabled =
    watchTicketBusy || externalActive;

  $("showToAi").classList.toggle("working", showToAiBusy);
  $("showToAiLabel").textContent = showToAiBusy ? "Capturing…" : "Show Everyone";
  $("showToAi").disabled =
    showToAiBusy || externalActive;

  $("companionPause").hidden =
    !companionModeActive || (!companionVideoStarted && !companionUserPaused);
  $("companionPause").classList.toggle("on", companionUserPaused);
  $("companionPauseLabel").textContent = companionUserPaused ? "Resume" : "Pause";
  $("companionPauseIcon").setAttribute(
    "d",
    companionUserPaused ? "M8 5v14l11-7z" : "M8 5v14M16 5v14"
  );

  $("companion").classList.toggle("on", companionModeActive);
  $("companionLabel").textContent = companionModeActive
    ? "Back to LIVE"
    : "Watch Together";
  $("companion").title = companionModeActive
    ? "Exit Watch Together and return to live control"
    : "Buffered synchronized playback; intentionally trails the computer by about " + companionDelaySeconds + " sec";
  $("companion").disabled =
    externalActive || (!companionModeActive && (!state.companionHlsUrl || !state.mediaUrl));

  $("modeStatus").classList.toggle("companion", companionModeActive && !companionPreparing);
  $("modeStatus").classList.toggle("preparing", companionPreparing);
  $("modeStatusTitle").textContent = companionPreparing
    ? "Preparing"
    : companionModeActive
      ? "Watch Together"
      : "LIVE";
  $("modeStatusText").textContent = companionPreparing
    ? "Building the audio/video buffer"
    : companionModeActive
      ? "Synchronized audio/video · About " + companionDelaySeconds + " sec"
      : "Live control view";

  $("companionPrep").classList.toggle("on", companionPreparing);
  $("companionStart").classList.remove("on");

  $("sound").classList.toggle("on", audioEnabled);
  $("sound").title = audioEnabled ? "Mute" : "Unmute";
  $("sound").setAttribute("aria-label", audioEnabled ? "Mute" : "Unmute");
  $("sound").disabled = externalActive || companionModeActive;
  const visibleAppBuild = state.appUiBuild || "v93";
  const visibleWorkerBuild = state.workerBuild || "—";
  $("title").textContent =
    "App " + visibleAppBuild + " · Worker " + visibleWorkerBuild;
  $("title").title = state.title || "";
  $("appVersion").textContent = "App " + visibleAppBuild + " · Worker " + visibleWorkerBuild;
  $("urlLabel").textContent = state.url || "No page open yet";

  if (externalActive) {
    $("frame").style.display = "none";
    $("liveCanvas").style.display = "none";
    $("mediaVideo").style.display = "none";
    $("empty").textContent = state.externalLogin.readyToResume
      ? "The Chrome window on your computer is closed. Reconnecting…\\nIf the view does not return after several seconds, select “Signed in — reconnect.”"
      : "Manual action required: a regular Chrome window opened on your computer.\\nSign in or complete the slider there, then close the entire Chrome window (not just the tab). The view reconnects automatically.";
    $("empty").style.display = "grid";
  } else {
    $("empty").textContent =
      "The remote browser appears here.\\nEnter a URL or ask ChatGPT / Claude to open a page.";
    if (companionModeActive && !state.takeover) {
      $("mediaVideo").style.display = "block";
      $("frame").style.display = "none";
      $("liveCanvas").style.display = "none";
      $("empty").style.display = "none";
    } else if (mediaModeActive && !state.takeover) {
      $("mediaVideo").style.display = "block";
      $("frame").style.display = "none";
      $("liveCanvas").style.display = "none";
      $("empty").style.display = "none";
    } else if (state.liveUrl || state.frameUrl || state.base64) {
      $("mediaVideo").style.display = "none";
      refreshImage();
      $("empty").style.display = "none";
    } else {
      $("mediaVideo").style.display = "none";
      $("frame").removeAttribute("src");
      $("empty").style.display = "grid";
    }
  }

  $("shell").classList.toggle("fullscreen", state.displayMode === "fullscreen");
  $("shell").classList.toggle("takeover", state.takeover && !externalActive);
  $("remotePad").classList.toggle("on", state.takeover && !externalActive);
  if (state.takeover && !externalActive) {
    ensureRemoteCursor();
    setTimeout(updateRemoteCursorOverlay, 0);
  } else {
    $("pointerDot").classList.remove("on");
  }
  $("fullscreen").classList.toggle("on", state.displayMode === "fullscreen");
  $("fullscreen").title = state.displayMode === "fullscreen" ? "Exit fullscreen" : "Fullscreen";
  $("fullscreen").setAttribute("aria-label", state.displayMode === "fullscreen" ? "Exit fullscreen" : "Fullscreen");
}
function refreshImage() {
  const frame = $("frame");

  if (companionModeActive && !state.takeover) {
    $("mediaVideo").style.display = "block";
    frame.style.display = "none";
    $("liveCanvas").style.display = "none";
    $("empty").style.display = "none";
    return;
  }

  if (mediaModeActive && !state.takeover) {
    $("mediaVideo").style.display = "block";
    frame.style.display = "none";
    $("liveCanvas").style.display = "none";
    $("empty").style.display = "none";
    return;
  }

  if (state.liveUrl && !liveFailed) {
    ensureLiveSocket();

    // Keep the last valid live frame if one exists. Before the first live
    // packet arrives (or after a host display-mode remount), show the signed
    // snapshot instead of an empty <img>.
    if (
      frame.dataset.mode === "live" &&
      frame.getAttribute("src")
    ) {
      return;
    }

    if (state.frameUrl) {
      frame.dataset.mode = "snapshot";
      const sep = state.frameUrl.includes("?") ? "&" : "?";
      frame.src = state.frameUrl + sep + "_ts=" + Date.now();
      frame.style.display = "block";
      $("liveCanvas").style.display = "none";
      $("empty").style.display = "none";
      return;
    }

    if (state.base64) {
      frame.dataset.mode = "snapshot";
      frame.src =
        "data:" + (state.mimeType || "image/png") +
        ";base64," + state.base64;
      frame.style.display = "block";
      $("liveCanvas").style.display = "none";
      $("empty").style.display = "none";
      return;
    }

    $("empty").style.display = "grid";
    return;
  }

  if (state.frameUrl) {
    frame.dataset.mode = "snapshot";
    const sep = state.frameUrl.includes("?") ? "&" : "?";
    frame.src = state.frameUrl + sep + "_ts=" + Date.now();
    frame.style.display = "block";
    $("liveCanvas").style.display = "none";
    $("empty").style.display = "none";
    return;
  }
  if (state.base64) {
    frame.dataset.mode = "snapshot";
    frame.src =
      "data:" + (state.mimeType || "image/png") +
      ";base64," + state.base64;
    frame.style.display = "block";
    $("liveCanvas").style.display = "none";
    $("empty").style.display = "none";
  }
}

function ensureLiveSocket() {
  if (
    !state.liveUrl ||
    liveFailed ||
    liveSuperseded ||
    (companionModeActive && !state.takeover) ||
    (mediaModeActive && !state.takeover)
  ) return;
  if (
    liveSocket &&
    stableSignedSocketTarget(liveSocketUrl) ===
      stableSignedSocketTarget(state.liveUrl) &&
    (liveSocket.readyState === WebSocket.OPEN ||
     liveSocket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  if (liveRetryTimer) {
    clearTimeout(liveRetryTimer);
    liveRetryTimer = null;
  }
  closeLiveSocket(false);

  const socket = new WebSocket(withCardStamp(state.liveUrl));
  socket.binaryType = "arraybuffer";
  liveSocket = socket;
  liveSocketUrl = state.liveUrl;

  socket.addEventListener("open", () => {
    if (liveSocket !== socket) return;
    liveRetryCount = 0;
    liveImageErrors = 0;
    liveFailed = false;
    setError("");
    setTimeout(grantNextLiveFrame, 120);
  });

  socket.addEventListener("message", (event) => {
    if (liveSocket !== socket) return;

    if (typeof event.data === "string") {
      try {
        const message = JSON.parse(event.data);
        if (
          message &&
          message.type === "command_result" &&
          typeof message.id === "string"
        ) {
          const pending = liveCommandPending.get(message.id);
          if (pending) {
            liveCommandPending.delete(message.id);
            clearTimeout(pending.timer);
            if (message.ok === true) pending.resolve(message);
            else pending.reject(new Error(message.error || "Live control failed"));
          }
        }
      } catch {}
      return;
    }

    if (event.data instanceof ArrayBuffer) {
      queueLivePacket(event.data);
      return;
    }
    if (event.data instanceof Blob) {
      void event.data.arrayBuffer().then((buffer) => {
        if (liveSocket === socket) queueLivePacket(buffer);
      });
    }
  });

  socket.addEventListener("close", (event) => {
    if (liveSocket !== socket) return;
    liveSocket = null;
    liveSocketUrl = "";

    if (event && event.code === 1012) {
      liveSuperseded = true;
      liveFailed = true;
      return;
    }

    if (event && event.code === 1006 && connected && !busy) {
      void refreshFrame();
      return;
    }

    scheduleLiveReconnect();
  });

  socket.addEventListener("error", () => {
    // The close event owns retry/fallback. Do not permanently poison
    // live mode on a transient network error.
  });
}

function scheduleLiveReconnect() {
  if (
    liveFailed ||
    liveSuperseded ||
    !state.liveUrl ||
    liveRetryTimer
  ) {
    return;
  }

  liveRetryCount += 1;
  const delay = Math.min(5000, 350 * (2 ** Math.min(liveRetryCount, 4)));
  liveRetryTimer = setTimeout(() => {
    liveRetryTimer = null;
    ensureLiveSocket();
  }, delay);
}

function grantNextLiveFrame(meta = {}) {
  const socket = liveSocket;
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  try {
    socket.send(JSON.stringify({
      type: "frame_ready",
      ...meta,
    }));
  } catch {}
}

function queueLivePacket(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 21) return;
  const view = new DataView(buffer);
  const sequence = view.getUint32(0);
  const capturedAt =
    view.getUint32(12) * 4294967296 + view.getUint32(16);
  if (!Number.isSafeInteger(capturedAt) || capturedAt <= 0) return;
  lastLivePacketAt = Date.now();

  // Never let a reconnect, resync, or stale socket paint history over a newer
  // frame. Sequence may reset when screencast restarts; capturedAt does not.
  if (capturedAt <= liveNewestCapturedAt) {
    grantNextLiveFrame({
      sequence,
      capturedAt,
      outcome: "dropped-stale-before-decode",
      presentationSemantics: "not-presented",
    });
    return;
  }
  liveNewestCapturedAt = capturedAt;

  // Newest-frame-wins: do not decode/render every websocket message.
  // If iOS/host is busy, intermediate video frames are intentionally dropped.
  pendingLivePacket = buffer;
  if (liveRenderScheduled) return;
  liveRenderScheduled = true;
  requestAnimationFrame(renderLatestLivePacket);
}

function renderLatestLivePacket() {
  liveRenderScheduled = false;
  const buffer = pendingLivePacket;
  pendingLivePacket = null;
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 21) return;

  const view = new DataView(buffer);
  const sequence = view.getUint32(0);
  const width = view.getUint32(4);
  const height = view.getUint32(8);
  const capturedAt =
    view.getUint32(12) * 4294967296 + view.getUint32(16);
  if (!(width > 0 && height > 0)) {
    grantNextLiveFrame({
      sequence,
      capturedAt,
      outcome: "invalid-dimensions",
      presentationSemantics: "not-presented",
    });
    return;
  }

  state.viewport = { width, height };
  $("shell").style.setProperty(
    "--remote-aspect",
    width + " / " + height
  );

  const jpeg = new Uint8Array(buffer, 20);
  const blob = new Blob([jpeg], { type: "image/jpeg" });

  let ackOutcome = "released-without-presentation";
  let ackSemantics = "not-presented";

  const finish = () => {
    grantNextLiveFrame({
      sequence,
      capturedAt,
      outcome: ackOutcome,
      presentationSemantics: ackSemantics,
      presentedAt:
        ackOutcome === "presented" ? Date.now() : undefined,
    });
    if (pendingLivePacket && !liveRenderScheduled) {
      liveRenderScheduled = true;
      requestAnimationFrame(renderLatestLivePacket);
    }
  };

  if (typeof createImageBitmap === "function") {
    void createImageBitmap(blob)
      .then((bitmap) => {
        const canvas = $("liveCanvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d", { alpha: false });
        if (!ctx) {
          bitmap.close?.();
          throw new Error("Canvas 2D unavailable");
        }

        if (capturedAt <= liveRenderedCapturedAt) {
          ackOutcome = "dropped-stale-after-decode";
          ackSemantics = "not-presented";
          bitmap.close?.();
          return;
        }
        ctx.drawImage(bitmap, 0, 0, width, height);
        liveRenderedCapturedAt = capturedAt;
        liveRenderedAtMs = Date.now();
        ackOutcome = "presented";
        ackSemantics = "canvas-draw-committed";
        bitmap.close?.();

        liveFailed = false;
        liveImageErrors = 0;
        canvas.style.display = "block";
        $("frame").style.display = "none";
        $("mediaVideo").style.display = "none";
        $("frame").removeAttribute("data-mode");
        $("empty").style.display = "none";
        updateRemoteCursorOverlay();
      })
      .catch((error) => {
        ackOutcome = "decode-failed";
        ackSemantics = "not-presented";
        setError("Could not decode live view: " + (
          error && error.message ? error.message : String(error)
        ));
      })
      .finally(finish);
    return;
  }

  // Older WebViews: one in-flight data URL frame at a time. Flow control
  // still prevents stale-frame buildup even on this fallback path.
  const reader = new FileReader();
  reader.onload = () => {
    const frame = $("frame");
    frame.dataset.mode = "live";
    frame.style.display = "block";
    $("liveCanvas").style.display = "none";
    $("mediaVideo").style.display = "none";
    $("empty").style.display = "none";
    frame.onload = () => {
      frame.onload = null;
      liveFailed = false;
      liveImageErrors = 0;
      liveRenderedCapturedAt = Math.max(liveRenderedCapturedAt, capturedAt);
      liveRenderedAtMs = Date.now();
      ackOutcome = "presented";
      ackSemantics = "img-load-complete";
      updateRemoteCursorOverlay();
      finish();
    };
    frame.onerror = () => {
      frame.onerror = null;
      ackOutcome = "decode-failed";
      ackSemantics = "not-presented";
      setError("Could not decode live view");
      finish();
    };
    frame.src = String(reader.result || "");
  };
  reader.onerror = () => {
    setError("Could not read live view");
    finish();
  };
  reader.readAsDataURL(blob);
}


function isIosLikeHost() {
  const ua = String(navigator.userAgent || "");
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

function canUseBufferedMediaLane() {
  if (isIosLikeHost()) return false;
  if (
    typeof MediaSource === "undefined" ||
    typeof MediaSource.isTypeSupported !== "function"
  ) {
    return false;
  }
  return MediaSource.isTypeSupported("video/webm;codecs=vp8");
}

function disableMediaForSession(message) {
  mediaSessionBlocked = true;
  closeMediaSocket(true, true);
  fallbackFromMedia(message || "");
}

function ensureMediaSocket() {
  const companion = companionModeActive;
  if (
    state.takeover ||
    state.externalLogin?.active ||
    !state.mediaUrl ||
    !companion
  ) {
    return;
  }
  if (
    mediaSocket &&
    stableSignedSocketTarget(mediaSocketUrl) ===
      stableSignedSocketTarget(state.mediaUrl) &&
    (mediaSocket.readyState === WebSocket.OPEN ||
     mediaSocket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  if (mediaRetryTimer) {
    clearTimeout(mediaRetryTimer);
    mediaRetryTimer = null;
  }
  closeMediaSocket(false, true);

  const socket = new WebSocket(withCardStamp(state.mediaUrl));
  socket.binaryType = "arraybuffer";
  mediaSocket = socket;
  mediaSocketUrl = state.mediaUrl;

  socket.addEventListener("open", () => {
    if (mediaSocket !== socket) return;
    mediaRetryCount = 0;
    try {
      socket.send(JSON.stringify({
        type: companionModeActive
          ? "companion_ready"
          : "media_ready",
        appUiBuild: state.appUiBuild || "v93",
        entry: companionModeActive ? String(companionStartedAt || "") : ""
      }));
      if (companionModeActive) sendCompanionPlaybackStatus();
      if (companionModeActive && companionUserPaused) sendCompanionPause();
    } catch {}
  });

  socket.addEventListener("message", (event) => {
    if (mediaSocket !== socket || state.takeover) return;
    if (companionModeActive) return;

    if (typeof event.data === "string") {
      try {
        const message = JSON.parse(event.data);
        if (
          message &&
          message.type === "media_stream_start" &&
          typeof message.streamId === "string" &&
          typeof message.mimeType === "string"
        ) {
          beginMediaStream(message.streamId, message.mimeType);
          return;
        }
        if (
          message &&
          message.type === "media_stream_end" &&
          (!message.streamId || message.streamId === mediaStreamId)
        ) {
          fallbackFromMedia("");
        }
      } catch {}
      return;
    }

    if (event.data instanceof ArrayBuffer) {
      queueMediaSegment(event.data);
      return;
    }
    if (event.data instanceof Blob) {
      void event.data.arrayBuffer().then((buffer) => {
        if (mediaSocket === socket) queueMediaSegment(buffer);
      });
    }
  });

  socket.addEventListener("close", (event) => {
    if (mediaSocket !== socket) return;
    mediaSocket = null;
    mediaSocketUrl = "";
    if (state.takeover || state.externalLogin?.active) return;
    // The server turned Watch Together away: too many viewers at once, or no TongPing points left.
    if (companionModeActive && event && (event.code === 4002 || event.code === 4003)) {
      stopCompanionPlayback(true);
      setError(event.code === 4002
        ? "Watch Together is busy. Try again shortly; live view remains available."
        : "Today’s TongPing credits are used up (reset at midnight China Standard Time). Watch Together is paused; live view and group chat remain available.");
      return;
    }
    if (companionModeActive && event && event.code === 1008) {
      // v90: another (newer) card took the companion lane. Stand down
      // instead of reconnecting and fighting it for the single capture.
      stopCompanionPlayback(true);
      setError("Watch Together is active in another window. Close it there, then try again here.");
      return;
    }
    if (companionModeActive) {
      if (companionReconnectTimer) clearTimeout(companionReconnectTimer);
      // v90: a refused upgrade (another card holds the lane) closes as 1006
      // before open. Back off instead of hammering every 1.2s forever.
      mediaRetryCount += 1;
      const companionDelay = Math.min(
        10_000,
        1200 * (2 ** Math.min(mediaRetryCount - 1, 3)),
      );
      if (mediaRetryCount >= 4) {
        setError("Could not connect Watch Together video. Another TongPing window may be open; close other windows to reconnect automatically.");
      }
      companionReconnectTimer = setTimeout(() => {
        companionReconnectTimer = null;
        if (companionModeActive) ensureMediaSocket();
      }, companionDelay);
      return;
    }
    if (event && event.code === 1012) return;
    mediaSessionBlocked = true;
    fallbackFromMedia("");
  });

  socket.addEventListener("error", () => {});
}

function scheduleMediaReconnect() {
  // Media transport is one-shot per mounted app session. Automatic reconnect
  // caused capture-helper tab storms and repeated MSE resets on mobile hosts.
  mediaSessionBlocked = true;
}

function beginMediaStream(streamId, mimeType) {
  if (
    !streamId ||
    !mimeType ||
    typeof MediaSource === "undefined" ||
    typeof MediaSource.isTypeSupported !== "function" ||
    !MediaSource.isTypeSupported(mimeType)
  ) {
    disableMediaForSession("This host does not support buffered media; returned to live view.");
    return;
  }

  resetMediaPlayback();
  mediaStreamId = String(streamId);
  mediaMimeType = String(mimeType);
  mediaSourceOpening = true;
  mediaSource = new MediaSource();

  const video = $("mediaVideo");
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  mediaSourceUrl = URL.createObjectURL(mediaSource);
  video.src = mediaSourceUrl;

  mediaSource.addEventListener("sourceopen", () => {
    if (!mediaSource || mediaSource.readyState !== "open") return;
    try {
      mediaSourceBuffer = mediaSource.addSourceBuffer(mediaMimeType);
      try { mediaSourceBuffer.mode = "sequence"; } catch {}
      mediaSourceBuffer.addEventListener("updateend", () => {
        syncMediaPlaybackToLiveEdge();
        drainMediaSegments();
      });
      mediaSourceBuffer.addEventListener("error", () => {
        disableMediaForSession("Buffered media decoding failed; returned to live view.");
      });
      mediaSourceOpening = false;
      drainMediaSegments();
    } catch (error) {
      disableMediaForSession(
        "Buffered media initialization failed; returned to live view."
      );
    }
  }, { once: true });
}

function queueMediaSegment(buffer) {
  if (
    !(buffer instanceof ArrayBuffer) ||
    buffer.byteLength <= 12 ||
    !mediaStreamId
  ) {
    return;
  }

  const payload = buffer.slice(12);
  if (!payload.byteLength) return;
  mediaSegmentQueue.push(payload);

  if (mediaSegmentQueue.length > 8) {
    disableMediaForSession("Video buffering fell behind; returned to live view.");
    return;
  }
  drainMediaSegments();
}

function drainMediaSegments() {
  if (
    mediaSourceOpening ||
    !mediaSourceBuffer ||
    mediaSourceBuffer.updating ||
    mediaSegmentQueue.length === 0
  ) {
    return;
  }

  try {
    const video = $("mediaVideo");
    const buffered = mediaSourceBuffer.buffered;
    if (
      buffered.length &&
      Number.isFinite(video.currentTime)
    ) {
      const firstStart = buffered.start(0);
      const cutoff = video.currentTime - 12;
      if (cutoff > firstStart + 2) {
        mediaSourceBuffer.remove(firstStart, cutoff);
        return;
      }
    }

    const next = mediaSegmentQueue.shift();
    mediaSourceBuffer.appendBuffer(next);
  } catch (error) {
    disableMediaForSession(
      "Could not append buffered media; returned to live view."
    );
  }
}

function syncMediaPlaybackToLiveEdge() {
  const video = $("mediaVideo");
  if (!mediaSourceBuffer || !mediaSourceBuffer.buffered.length) return;

  try {
    const index = mediaSourceBuffer.buffered.length - 1;
    const start = mediaSourceBuffer.buffered.start(index);
    const end = mediaSourceBuffer.buffered.end(index);
    const lag = end - video.currentTime;

    if (!mediaPlaybackStarted) {
      video.currentTime = Math.max(start, end - 0.9);
      video.playbackRate = 1;
      mediaPlaybackStarted = true;
    } else if (lag > 2.4) {
      video.currentTime = Math.max(start, end - 1.0);
      video.playbackRate = 1.035;
    } else if (lag > 1.35) {
      video.playbackRate = 1.05;
    } else if (lag > 0.95) {
      video.playbackRate = 1.025;
    } else {
      video.playbackRate = 1;
    }

    void video.play().catch(() => {});

    if (!mediaModeActive) {
      mediaModeActive = true;
      video.style.display = "block";
      $("frame").style.display = "none";
      $("liveCanvas").style.display = "none";
      $("empty").style.display = "none";
      closeLiveSocket(false);
      setNudgeStatus("Buffered video mode");
    }
  } catch {}
}

function fallbackFromMedia(message) {
  resetMediaPlayback();
  if (message) setNudgeStatus(message);
  if (!state.takeover && !state.externalLogin?.active) {
    liveFailed = false;
    liveSuperseded = false;
    ensureLiveSocket();
    refreshImage();
    const frame = $("frame");
    const canvas = $("liveCanvas");
    if (
      frame.style.display === "none" &&
      canvas.style.display === "none"
    ) {
      frame.style.display = "block";
    }
  }
}

function resetMediaPlayback() {
  mediaModeActive = false;
  mediaSourceOpening = false;
  mediaPlaybackStarted = false;
  mediaSegmentQueue = [];
  mediaStreamId = "";
  mediaMimeType = "";
  mediaSourceBuffer = null;

  if (mediaSource && mediaSource.readyState === "open") {
    try { mediaSource.endOfStream(); } catch {}
  }
  mediaSource = null;

  const video = $("mediaVideo");
  try { video.pause(); } catch {}
  video.style.display = "none";
  video.removeAttribute("src");
  try { video.load(); } catch {}

  if (mediaSourceUrl) {
    try { URL.revokeObjectURL(mediaSourceUrl); } catch {}
    mediaSourceUrl = "";
  }
}

function closeMediaSocket(
  clearPlayback = true,
  suppressLiveFallback = false,
  closeCode = 1000
) {
  if (mediaRetryTimer) {
    clearTimeout(mediaRetryTimer);
    mediaRetryTimer = null;
  }
  const socket = mediaSocket;
  mediaSocket = null;
  mediaSocketUrl = "";
  if (socket) {
    try {
      socket.close(closeCode, closeCode === 1000 ? "media viewer reset" : "companion leave");
    } catch {}
  }

  const wasActive = mediaModeActive;
  if (clearPlayback) resetMediaPlayback();

  if (
    wasActive &&
    !suppressLiveFallback &&
    !state.takeover &&
    !state.externalLogin?.active
  ) {
    liveFailed = false;
    liveSuperseded = false;
    ensureLiveSocket();
  }
}

function formatCompanionTime(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  if (hours > 0) {
    return String(hours) + ":" + String(minutes).padStart(2, "0") + ":" + String(secs).padStart(2, "0");
  }
  return String(minutes).padStart(2, "0") + ":" + String(secs).padStart(2, "0");
}

function parseCompanionTimelineMetadata(text) {
  const numberTag = (name) => {
    const match = text.match(new RegExp("#TONGPING-" + name + ":([-+]?[0-9]+(?:\\.[0-9]+)?)"));
    if (!match) return null;
    const value = Number(match[1]);
    return Number.isFinite(value) ? value : null;
  };
  const anchorPts = numberTag("SOURCE-ANCHOR-PTS");
  const anchorDateMs = numberTag("SOURCE-ANCHOR-DATE-MS");
  const playbackRate = numberTag("SOURCE-PLAYBACK-RATE");
  const duration = numberTag("SOURCE-DURATION");
  const bufferStart = numberTag("BUFFER-START-PTS");
  const bufferEnd = numberTag("BUFFER-END-PTS");

  // Samples re-read the source every few seconds, so a looping clip or a
  // switched video maps correctly; the single anchor is only a fallback.
  const samples = [];
  for (const line of text.split(String.fromCharCode(10))) {
    if (!line.startsWith("#TONGPING-SOURCE-SAMPLE:")) continue;
    const parts = line.slice("#TONGPING-SOURCE-SAMPLE:".length).trim().split(",");
    const dateMs = Number(parts[0]);
    const pts = Number(parts[1]);
    const rate = Number(parts[2]);
    const sampleDuration = parts[3] === "-" ? null : Number(parts[3]);
    if (!Number.isFinite(dateMs) || !Number.isFinite(pts) || !Number.isFinite(rate) || rate < 0) continue;
    samples.push({
      dateMs,
      pts,
      rate,
      duration: sampleDuration !== null && Number.isFinite(sampleDuration) && sampleDuration > 0
        ? sampleDuration
        : null
    });
  }
  if (samples.length > 0) {
    samples.sort((a, b) => a.dateMs - b.dateMs);
    companionSourceSamples = samples;
  }

  if (anchorPts !== null) companionSourceAnchorPts = anchorPts;
  if (anchorDateMs !== null) companionSourceAnchorDateMs = anchorDateMs;
  if (playbackRate !== null && playbackRate > 0) companionSourcePlaybackRate = playbackRate;
  if (duration !== null && duration >= 0) companionSourceDuration = duration;
  if (bufferStart !== null) companionBufferStartPts = bufferStart;
  if (bufferEnd !== null) companionBufferEndPts = bufferEnd;
}

function applyCompanionSourceSample(presentationDateMs) {
  if (presentationDateMs === null || companionSourceSamples.length === 0) return;
  let pick = companionSourceSamples[0];
  for (const sample of companionSourceSamples) {
    if (sample.dateMs > presentationDateMs) break;
    pick = sample;
  }
  companionSourceAnchorPts = pick.pts;
  companionSourceAnchorDateMs = pick.dateMs;
  // A paused source has rate 0; keep a tiny positive rate so seek math that
  // divides by it stays finite.
  companionSourcePlaybackRate = pick.rate > 0 ? pick.rate : 0.000001;
  if (pick.duration !== null) companionSourceDuration = pick.duration;
}

function currentCompanionSourcePts(video = $("mediaVideo")) {
  const presentationDateMs = companionPresentationDateMs(video);
  applyCompanionSourceSample(presentationDateMs);
  if (
    presentationDateMs !== null &&
    companionSourceAnchorPts !== null &&
    companionSourceAnchorDateMs !== null &&
    companionSourcePlaybackRate > 0
  ) {
    const pts = Math.max(
      0,
      companionSourceAnchorPts +
        ((presentationDateMs - companionSourceAnchorDateMs) / 1000) *
          companionSourcePlaybackRate
    );
    return companionSourceDuration !== null && companionSourceDuration > 0
      ? Math.min(pts, companionSourceDuration)
      : pts;
  }

  if (
    companionBufferStartPts !== null &&
    companionBufferEndPts !== null &&
    video.seekable &&
    video.seekable.length > 0
  ) {
    try {
      const start = video.seekable.start(0);
      const end = video.seekable.end(video.seekable.length - 1);
      if (end > start) {
        const ratio = Math.max(0, Math.min(1, (video.currentTime - start) / (end - start)));
        return companionBufferStartPts +
          ratio * (companionBufferEndPts - companionBufferStartPts);
      }
    } catch {}
  }
  return null;
}

function sourcePtsToBufferedMediaTime(targetPts, video = $("mediaVideo")) {
  if (
    companionSourceAnchorPts !== null &&
    companionSourceAnchorDateMs !== null &&
    companionSourcePlaybackRate > 0 &&
    typeof video.getStartDate === "function"
  ) {
    try {
      const startDate = video.getStartDate();
      const startMs =
        startDate instanceof Date && Number.isFinite(startDate.getTime())
          ? startDate.getTime()
          : NaN;
      if (Number.isFinite(startMs)) {
        const targetDateMs =
          companionSourceAnchorDateMs +
          ((targetPts - companionSourceAnchorPts) / companionSourcePlaybackRate) * 1000;
        return (targetDateMs - startMs) / 1000;
      }
    } catch {}
  }

  if (
    companionBufferStartPts !== null &&
    companionBufferEndPts !== null &&
    companionBufferEndPts > companionBufferStartPts &&
    video.seekable &&
    video.seekable.length > 0
  ) {
    try {
      const start = video.seekable.start(0);
      const end = video.seekable.end(video.seekable.length - 1);
      const ratio =
        (targetPts - companionBufferStartPts) /
        (companionBufferEndPts - companionBufferStartPts);
      return start + Math.max(0, Math.min(1, ratio)) * (end - start);
    } catch {}
  }
  return null;
}

function renderCompanionTimeline() {
  const root = $("companionTimeline");
  if (!root) return;
  root.classList.toggle("on", companionModeActive);
  if (!companionModeActive) return;

  const video = $("mediaVideo");
  const currentSourcePts = currentCompanionSourcePts(video);
  const slider = $("companionSeek");
  const duration =
    companionSourceDuration !== null && companionSourceDuration > 0
      ? companionSourceDuration
      : null;

  if (duration !== null) {
    slider.max = String(duration);
    slider.disabled = companionSeekPending;
    if (!companionSeekDragging && currentSourcePts !== null) {
      slider.value = String(Math.max(0, Math.min(duration, currentSourcePts)));
    }
    $("timelineDuration").textContent = formatCompanionTime(duration);
  } else {
    slider.max = "1";
    slider.disabled = true;
    $("timelineDuration").textContent = "--:--";
  }

  const shownPts = companionSeekDragging ? Number(slider.value) : currentSourcePts;
  $("timelineCurrent").textContent = formatCompanionTime(shownPts);

  const buffered = $("timelineBuffered");
  if (
    duration !== null &&
    companionBufferStartPts !== null &&
    companionBufferEndPts !== null
  ) {
    const left = Math.max(0, Math.min(100, companionBufferStartPts / duration * 100));
    const right = Math.max(left, Math.min(100, companionBufferEndPts / duration * 100));
    buffered.style.left = left.toFixed(3) + "%";
    buffered.style.width = (right - left).toFixed(3) + "%";
    $("timelineHint").textContent =
      formatCompanionTime(companionBufferStartPts) + " – " +
      formatCompanionTime(companionBufferEndPts) + " buffered";
  } else {
    buffered.style.left = "0%";
    buffered.style.width = "0%";
    $("timelineHint").textContent = companionSeekPending
      ? "Rebuilding buffer from the new position…"
      : "Waiting for buffered timeline";
  }
}

async function seekCompanionToSource(targetPts) {
  if (!companionModeActive || companionSeekPending) return;
  // Seeking rebuilds the capture at the new position and plays from there.
  if (companionUserPaused) {
    companionUserPaused = false;
    hidePausedOverlay();
    sendCompanionPause();
  }
  const target = Math.max(
    0,
    companionSourceDuration !== null
      ? Math.min(companionSourceDuration, Number(targetPts) || 0)
      : Number(targetPts) || 0
  );
  const insideBuffer =
    companionBufferStartPts !== null &&
    companionBufferEndPts !== null &&
    target >= companionBufferStartPts - 0.25 &&
    target <= companionBufferEndPts + 0.25;

  const video = $("mediaVideo");
  if (insideBuffer) {
    const mediaTime = sourcePtsToBufferedMediaTime(target, video);
    if (mediaTime !== null && Number.isFinite(mediaTime)) {
      try {
        video.currentTime = Math.max(0, mediaTime);
        setNudgeStatus("Seek within buffer · " + formatCompanionTime(target) + " · staying in Watch Together");
        sendCompanionPlaybackStatus();
        renderCompanionTimeline();
        return;
      } catch {}
    }
  }

  companionSeekPending = true;
  companionPhase = "preparing";
  companionVideoStarted = false;
  companionPlaybackArmed = false;
  companionBufferedSeconds = 0;
  companionBufferStartPts = null;
  companionBufferEndPts = null;
  try { video.pause(); } catch {}
  video.removeAttribute("src");
  try { video.load(); } catch {}
  video.style.display = "none";
  $("companionPrep").classList.add("on");
  $("companionPrepTitle").textContent = "Reconnecting from the new position…";
  $("companionPrepText").textContent =
    "Target " + formatCompanionTime(target) +
    " is outside the current buffer. Seeking on the computer and rebuilding a 20-second audio/video buffer.";
  $("companionCounter").textContent =
    "Rebuffering 0 / " + companionDelaySeconds + "  sec";
  renderCompanionTimeline();

  try {
    await call(
      "browser_app_companion_seek_source",
      actorArgs({ targetSeconds: target })
    );
    companionSourceAnchorPts = target;
    companionSourceAnchorDateMs = Date.now();
    companionSourcePlaybackRate = 1;
    mediaSessionBlocked = false;

    video.controls = false;
    video.autoplay = true;
    video.playsInline = true;
    video.muted = false;
    video.classList.add("companionPlayback");
    video.src = companionPlaybackWaitUrl();
    companionPlaybackArmed = true;
    try { video.load(); } catch {}
    void video.play().catch(() => {
      companionPlaybackArmed = false;
    });
    updateCompanionPreparingUi();
    scheduleCompanionProbe(250);
  } catch (error) {
    setError(error && error.message ? error.message : error);
    setNudgeStatus("Seek failed");
  } finally {
    companionSeekPending = false;
    renderCompanionTimeline();
  }
}

function updateCompanionPreparingUi() {
  if (!companionModeActive) return;
  const cachedSeconds = Math.max(
    0,
    Math.min(companionDelaySeconds, Math.floor(companionBufferedSeconds))
  );
  const progress = Math.max(
    4,
    Math.min(100, cachedSeconds / companionDelaySeconds * 100)
  );
  $("companionProgressBar").style.width = progress.toFixed(1) + "%";
  $("companionCounter").textContent =
    "Buffered " + cachedSeconds + " / " + companionDelaySeconds + "  sec";

  if (companionPhase === "ready") {
    $("companionPrepTitle").textContent = "Buffer ready; starting automatically…";
    $("companionCounter").textContent =
      "Buffered " + companionDelaySeconds + " / " + companionDelaySeconds + "  sec";
    $("companionPrepText").textContent =
      "No action needed; reconnecting audio and video on the same recording timeline.";
    return;
  }
  if (companionCaptureIssue && cachedSeconds < 1 && companionPhase === "preparing") {
    $("companionPrepTitle").textContent =
      companionCaptureIssue === "locked"
        ? "The computer appears to be locked"
        : companionCaptureIssue === "no-video"
          ? "No video is open on the computer yet"
          : "Recording has not started on the computer";
    $("companionPrepText").textContent =
      companionCaptureIssue === "locked"
        ? "The view cannot be shared while the computer is locked or asleep. Unlock it to reconnect automatically."
        : companionCaptureIssue === "no-video"
          ? "Open a video on the computer to start recording automatically."
          : "Retrying automatically; no action needed.";
    return;
  }
  if (companionPhase === "buffering") {
    $("companionPrepTitle").textContent = "Reconnecting the buffer…";
    $("companionPrepText").textContent =
      "The network briefly dropped. Waiting for audio and video to reconnect together.";
    return;
  }

  if (cachedSeconds >= companionDelaySeconds) {
    $("companionPrepTitle").textContent = "Buffer full; waiting for playable segments…";
    $("companionPrepText").textContent =
      "The audio/video buffer has reached " + companionDelaySeconds +
      " sec; the player is waiting for the first playable HLS segments. No action needed.";
    return;
  }

  $("companionPrepTitle").textContent = "Building a short buffer…";
  $("companionPrepText").textContent =
    "Actual buffer: " + cachedSeconds + " sec; playback starts automatically at " +
    companionDelaySeconds + " sec.";
}

function clearCompanionProbe() {
  if (companionProbeTimer) {
    clearTimeout(companionProbeTimer);
    companionProbeTimer = null;
  }
}

function scheduleCompanionProbe(delay = 700) {
  clearCompanionProbe();
  companionProbeTimer = setTimeout(() => {
    companionProbeTimer = null;
    void probeCompanionPlaylist();
  }, delay);
}

async function probeCompanionPlaylist() {
  if (!companionModeActive || state.takeover) return;
  updateCompanionPreparingUi();

  try {
    const url = companionPlaylistUrl();
    const response = await fetch(
      url + (url.includes("?") ? "&" : "?") + "_probe=" + Date.now(),
      { cache: "no-store" }
    );
    const text = response.ok ? await response.text() : "";
    const streamMatch = text.match(
      /#TONGPING-STREAM-ID:([^\\r\\n]+)/
    );
    const nextStreamId = streamMatch ? String(streamMatch[1] || "").trim() : "";
    const video = $("mediaVideo");
    const streamChanged =
      Boolean(nextStreamId) &&
      Boolean(companionStreamId) &&
      nextStreamId !== companionStreamId;
    if (nextStreamId) companionStreamId = nextStreamId;

    companionCaptureIssue =
      text.indexOf("#TONGPING-CAPTURE-ISSUE:locked") >= 0
        ? "locked"
        : text.indexOf("#TONGPING-CAPTURE-ISSUE:no-video") >= 0
          ? "no-video"
          : text.indexOf("#TONGPING-CAPTURE-ISSUE:retrying") >= 0
            ? "retrying"
            : "";
    const bufferedMatch = text.match(
      /#TONGPING-BUFFERED-SECONDS:([0-9]+(?:\.[0-9]+)?)/
    );
    if (bufferedMatch) {
      companionBufferedSeconds = Math.max(
        0,
        Number(bufferedMatch[1]) || 0
      );
      updateCompanionPreparingUi();
    }
    parseCompanionTimelineMetadata(text);
    renderCompanionTimeline();
    const segmentCount = text
      .split(/\\r?\\n/)
      .map((line) => line.trim())
      .filter((line) => /\\.m4s(?:\\?|$)/.test(line))
      .length;

    if (streamChanged) {
      // A replacement recorder starts a new media timeline. Safari can hold
      // the old currentTime beyond every segment in that generation; reload
      // the same _playwait source once, then resume from its new window.
      companionVideoStarted = false;
      if (segmentCount >= 2) {
        companionLastRecoveryLoadAt = Date.now();
        companionLastProgressTime = 0;
        companionLastProgressAt = 0;
        video.load();
      }
    }

    const now = Date.now();
    const stalledPlayback =
      companionVideoStarted &&
      companionLastProgressAt > 0 &&
      now - companionLastProgressAt >= 6000 &&
      video.readyState < 3 &&
      !companionSeekPending &&
      now - companionLastUserMediaInteractionAt >= 1800;
    if (companionUserPaused) {
      scheduleCompanionProbe(1500);
      return;
    }
    if (segmentCount >= 2 &&
        (!companionVideoStarted || video.paused || stalledPlayback)) {
      video.style.display = "block";
      if ((video.paused || stalledPlayback) && !video.ended) {
        try {
          // A transient low-buffer pause needs play(), not another load().
          // Only reset an errored or genuinely stalled HLS source, at most
          // once per recovery window, preserving the same _playwait URL.
          if ((video.error || stalledPlayback) &&
              now - companionLastRecoveryLoadAt >= 8000) {
            companionLastRecoveryLoadAt = now;
            video.load();
          }
          await video.play();
          companionPlaybackArmed = true;
        } catch (error) {
          companionVideoStarted = false;
          companionPhase = "ready";
          const detail =
            error && error.name
              ? String(error.name) + (error.message ? ": " + String(error.message) : "")
              : String(error || "play rejected");
          setNudgeStatus("Retrying autoplay · " + detail);
          updateCompanionPreparingUi();
          render();
          scheduleCompanionProbe(900);
          return;
        }
      }
      companionVideoStarted = !video.paused && !video.ended;
      companionPlaybackArmed = companionVideoStarted || companionPlaybackArmed;
      if (!companionVideoStarted) {
        companionPhase = "ready";
        updateCompanionPreparingUi();
        render();
      }
      scheduleCompanionProbe(companionVideoStarted ? 1500 : 900);
      return;
    }
  } catch {}

  if (companionModeActive) {
    scheduleCompanionProbe(companionVideoStarted ? 1500 : 1200);
  }
}

function companionPresentationDateMs(video) {
  try {
    if (typeof video.getStartDate === "function") {
      const start = video.getStartDate();
      const startMs =
        start instanceof Date && Number.isFinite(start.getTime())
          ? start.getTime()
          : NaN;
      const currentTime = Number(video.currentTime);
      if (
        Number.isFinite(startMs) &&
        Number.isFinite(currentTime) &&
        currentTime >= 0
      ) {
        return Math.round(startMs + currentTime * 1000);
      }
    }
  } catch {}
  return null;
}

function sendCompanionPlaybackStatus() {
  if (
    !companionModeActive ||
    !mediaSocket ||
    mediaSocket.readyState !== WebSocket.OPEN
  ) {
    return;
  }
  const video = $("mediaVideo");
  const currentTime = Number(video.currentTime);
  const duration = Number(video.duration);
  const sourcePts = currentCompanionSourcePts(video);
  renderCompanionTimeline();
  try {
    mediaSocket.send(JSON.stringify({
      type: "companion_playback_status",
      currentTime:
        Number.isFinite(currentTime) && currentTime >= 0
          ? currentTime
          : null,
      duration:
        Number.isFinite(duration) && duration >= 0
          ? duration
          : null,
      sourcePts,
      bufferStartPts: companionBufferStartPts,
      bufferEndPts: companionBufferEndPts,
      sourceDuration: companionSourceDuration,
      presentationDateMs: companionPresentationDateMs(video),
      paused: video.paused === true,
      ended: video.ended === true,
      readyState: Number(video.readyState || 0),
      wallClockAt: Date.now()
    }));
  } catch {}
}

function startCompanionPlaybackStatus() {
  if (companionPlaybackStatusTimer) {
    clearInterval(companionPlaybackStatusTimer);
  }
  sendCompanionPlaybackStatus();
  companionPlaybackStatusTimer = setInterval(() => {
    sendCompanionPlaybackStatus();
  }, 500);
}

function stopCompanionPlaybackStatus() {
  if (!companionPlaybackStatusTimer) return;
  clearInterval(companionPlaybackStatusTimer);
  companionPlaybackStatusTimer = null;
}

function companionPlaylistUrl() {
  if (!state.companionHlsUrl) return "";
  try {
    const url = new URL(state.companionHlsUrl);
    url.searchParams.set("delay", String(companionDelaySeconds));
    // Name this watch session on every playlist request, so the server drops
    // older buffered media even if this request beats companion_ready.
    if (companionModeActive && companionStartedAt) {
      url.searchParams.set("entry", String(companionStartedAt));
    }
    return url.toString();
  } catch {
    return state.companionHlsUrl;
  }
}

function companionPlaybackWaitUrl() {
  const base = companionPlaylistUrl();
  if (!base) return "";
  try {
    const url = new URL(base);
    url.searchParams.set("_playwait", "1");
    url.searchParams.set("_play", String(Date.now()));
    return url.toString();
  } catch {
    return (
      base +
      (base.includes("?") ? "&" : "?") +
      "_playwait=1&_play=" +
      Date.now()
    );
  }
}

function stopCompanionPlayback(returnToLive = true) {
  companionModeActive = false;
  companionUserPaused = false;
  hidePausedOverlay();
  companionPhase = "idle";
  companionStartedAt = 0;
  companionVideoStarted = false;
  companionPlaybackArmed = false;
  companionBufferedSeconds = 0;
  companionSourceAnchorPts = null;
  companionSourceAnchorDateMs = null;
  companionSourcePlaybackRate = 1;
  companionSourceDuration = null;
  companionSourceSamples = [];
  companionStreamId = "";
  companionBufferStartPts = null;
  companionBufferEndPts = null;
  companionSeekPending = false;
  clearCompanionBufferingCheck();
  companionLastProgressTime = 0;
  companionLastProgressAt = 0;
  companionLastRecoveryLoadAt = 0;
  companionLastUserMediaInteractionAt = 0;
  if (companionAutoResumeTimer) {
    clearTimeout(companionAutoResumeTimer);
    companionAutoResumeTimer = null;
  }
  clearCompanionProbe();
  stopCompanionPlaybackStatus();

  if (companionReconnectTimer) {
    clearTimeout(companionReconnectTimer);
    companionReconnectTimer = null;
  }

  const video = $("mediaVideo");
  try { video.pause(); } catch {}
  video.controls = false;
  video.muted = true;
  video.classList.remove("companionPlayback");
  video.removeAttribute("src");
  try { video.load(); } catch {}
  video.style.display = "none";

  $("companionPrep").classList.remove("on");
  $("companionProgressBar").style.width = "4%";

  // 4001 tells the server she chose LIVE, so it frees the uplink at once.
  closeMediaSocket(false, true, returnToLive ? 4001 : 1000);

  if (
    returnToLive &&
    !state.takeover &&
    !state.externalLogin?.active
  ) {
    liveFailed = false;
    liveSuperseded = false;
    ensureLiveSocket();
    refreshImage();
  }
  render();
}

function sendCompanionPause() {
  if (!mediaSocket || mediaSocket.readyState !== WebSocket.OPEN) return;
  try {
    mediaSocket.send(JSON.stringify({
      type: "companion_pause",
      paused: companionUserPaused
    }));
  } catch {}
}

// Hold the paused frame on screen ourselves: some hosts' players show
// nothing while an HLS element is paused.
function showPausedOverlay(video) {
  const image = $("pausedFrame");
  image.removeAttribute("src");
  try {
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
      image.src = canvas.toDataURL("image/jpeg", 0.86);
    }
  } catch {}
  $("pausedOverlay").hidden = false;
}
function hidePausedOverlay() {
  $("pausedOverlay").hidden = true;
  $("pausedFrame").removeAttribute("src");
}

function toggleCompanionUserPause() {
  if (!companionModeActive) return;
  const video = $("mediaVideo");
  companionUserPaused = !companionUserPaused;
  companionLastUserMediaInteractionAt = Date.now();
  if (companionAutoResumeTimer) {
    clearTimeout(companionAutoResumeTimer);
    companionAutoResumeTimer = null;
  }
  clearCompanionBufferingCheck();
  sendCompanionPause();
  if (companionUserPaused) {
    showPausedOverlay(video);
    try { video.pause(); } catch {}
    setNudgeStatus("Paused · The computer is paused here too");
  } else {
    hidePausedOverlay();
    companionLastProgressAt = 0;
    void video.play().catch(() => {
      scheduleCompanionProbe(300);
    });
    setNudgeStatus("Resumed Watch Together");
  }
  sendCompanionPlaybackStatus();
  render();
}

async function toggleCompanionMode() {
  if (companionModeActive) {
    stopCompanionPlayback(true);
    setNudgeStatus("Back to LIVE");
    return;
  }
  if (!state.mediaUrl || !state.companionHlsUrl) {
    setError("Watch Together is not ready yet");
    return;
  }

  closeAudioSocket(true);
  closeMediaSocket(true, true);
  closeLiveSocket(false);

  companionModeActive = true;
  companionUserPaused = false;
  companionStreamId = "";
  companionSourceSamples = [];
  companionLastUserMediaInteractionAt = 0;
  if (companionAutoResumeTimer) {
    clearTimeout(companionAutoResumeTimer);
    companionAutoResumeTimer = null;
  }
  companionPhase = "preparing";
  companionStartedAt = Date.now();
  companionVideoStarted = false;
  companionBufferedSeconds = 0;
  mediaSessionBlocked = false;

  const video = $("mediaVideo");
  video.controls = false;
  video.autoplay = true;
  video.playsInline = true;
  video.muted = false;
  video.classList.add("companionPlayback");
  video.src = companionPlaybackWaitUrl();
  video.style.display = "none";
  companionPlaybackArmed = true;
  try { video.load(); } catch {}
  void video.play().catch(() => {
    companionPlaybackArmed = false;
  });

  $("frame").style.display = "none";
  $("liveCanvas").style.display = "none";
  $("empty").style.display = "none";
  $("companionProgressBar").style.width = "4%";

  ensureMediaSocket();
  startCompanionPlaybackStatus();
  updateCompanionPreparingUi();
  setNudgeStatus(
    "Preparing Watch Together · Building audio/video buffer · You can return to LIVE anytime"
  );
  render();
  renderCompanionTimeline();
  scheduleCompanionProbe(250);
}

async function startPreparedCompanionPlayback() {
  if (!companionModeActive) return;
  const video = $("mediaVideo");
  try {
    video.muted = false;
    await video.play();
    companionVideoStarted = !video.paused && !video.ended;
    companionPlaybackArmed = companionVideoStarted || companionPlaybackArmed;
  } catch (error) {
    const detail =
      error && error.name
        ? String(error.name) + (error.message ? ": " + String(error.message) : "")
        : String(error || "play rejected");
    setNudgeStatus("Retrying autoplay · " + detail);
    companionPhase = "ready";
    updateCompanionPreparingUi();
    render();
    scheduleCompanionProbe(900);
  }
}

function sendAudioReady() {
  const socket = audioSocket;
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  try {
    socket.send(JSON.stringify({ type: "audio_ready" }));
  } catch {}
}

function sendAudioStatus() {
  const socket = audioSocket;
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  const now =
    audioContext && Number.isFinite(audioContext.currentTime)
      ? audioContext.currentTime
      : 0;
  const gain =
    audioOutputGain && audioOutputGain.gain
      ? Number(audioOutputGain.gain.value)
      : 0;
  try {
    socket.send(JSON.stringify({
      type: "audio_status",
      enabled: audioEnabled === true,
      contextState: audioContext ? String(audioContext.state || "") : "none",
      packetsReceived: audioPacketsReceived,
      scheduledAheadMs: Math.round((audioNextTime - now) * 1000),
      pcmRms: audioLastPcmRms,
      gain: Number.isFinite(gain) ? gain : 0,
      presentationClock: presentationSourceNowMs() !== null,
      liveRenderedCapturedAt,
      liveFrameAgeMs: liveRenderedAtMs ? Math.max(0, Date.now() - liveRenderedAtMs) : -1,
      audioCapturedAt: audioLastCapturedAt,
      syncErrorMs: audioSyncErrorMs
    }));
  } catch {}
}

function startAudioStatusTimer() {
  if (audioStatusTimer) clearInterval(audioStatusTimer);
  audioStatusTimer = setInterval(() => {
    sendAudioStatus();
  }, 1000);
}

function stopAudioStatusTimer() {
  if (!audioStatusTimer) return;
  clearInterval(audioStatusTimer);
  audioStatusTimer = null;
}

function ensureAudioOutputGain() {
  if (!audioContext) return null;
  if (audioOutputGain) return audioOutputGain;
  const gain = audioContext.createGain();
  gain.gain.value = 1;
  gain.connect(audioContext.destination);
  audioOutputGain = gain;
  return gain;
}

function presentationSourceNowMs() {
  if (!liveRenderedCapturedAt || !liveRenderedAtMs) return null;
  const frameAgeMs = Date.now() - liveRenderedAtMs;
  if (
    !Number.isFinite(frameAgeMs) ||
    frameAgeMs < 0 ||
    frameAgeMs > AV_SYNC_MAX_FRAME_AGE_MS
  ) {
    return null;
  }
  return liveRenderedCapturedAt + frameAgeMs;
}

function desiredAudioAheadSeconds(capturedAt) {
  const sourceNow = presentationSourceNowMs();
  if (
    sourceNow === null ||
    !Number.isSafeInteger(capturedAt) ||
    capturedAt <= 0
  ) {
    return null;
  }
  const sourceLeadSeconds = (capturedAt - sourceNow) / 1000;
  return Math.max(
    AV_SYNC_MIN_AHEAD,
    Math.min(
      AV_SYNC_MAX_AHEAD,
      sourceLeadSeconds + AV_SYNC_BASE_AHEAD
    )
  );
}

function resetAudioSchedule(now, crossfade = true, targetAhead = AUDIO_TARGET_AHEAD) {
  if (!audioContext) return;
  const oldGain = audioOutputGain;
  const oldSources = [...audioScheduledSources];
  audioScheduledSources.clear();

  if (oldGain && crossfade) {
    try {
      oldGain.gain.cancelScheduledValues(now);
      oldGain.gain.setValueAtTime(oldGain.gain.value, now);
      oldGain.gain.linearRampToValueAtTime(0, now + 0.012);
    } catch {}
  }

  for (const source of oldSources) {
    try { source.stop(now + (crossfade ? 0.014 : 0)); } catch {}
  }

  if (oldGain) {
    setTimeout(() => {
      try { oldGain.disconnect(); } catch {}
    }, 50);
  }

  const nextGain = audioContext.createGain();
  nextGain.gain.setValueAtTime(crossfade ? 0 : 1, now);
  if (crossfade) {
    nextGain.gain.linearRampToValueAtTime(1, now + 0.014);
  }
  nextGain.connect(audioContext.destination);
  audioOutputGain = nextGain;
  audioNextTime = now + Math.max(
    AV_SYNC_MIN_AHEAD,
    Math.min(AV_SYNC_MAX_AHEAD, targetAhead)
  );
}

function audioSequenceDelta(sequence, previous) {
  if (previous === null) return 1;
  return (sequence - previous + 0x100000000) % 0x100000000;
}

function scheduleAudioPacket(buffer) {
  if (
    !audioEnabled ||
    !audioContext ||
    !(buffer instanceof ArrayBuffer) ||
    buffer.byteLength < 26
  ) {
    sendAudioReady();
    return;
  }

  const view = new DataView(buffer);
  const sequence = view.getUint32(0);
  const sampleRate = view.getUint32(4);
  const channels = view.getUint32(8);
  const frames = view.getUint32(12);
  const capturedAt =
    view.getUint32(16) * 4294967296 + view.getUint32(20);
  const payloadBytes = buffer.byteLength - 24;

  if (
    sampleRate < 8000 ||
    sampleRate > 96000 ||
    channels !== 1 ||
    frames < 1 ||
    !Number.isSafeInteger(capturedAt) ||
    capturedAt <= 0 ||
    payloadBytes !== frames * 2
  ) {
    sendAudioReady();
    return;
  }

  if (audioContext.state !== "running") {
    void audioContext.resume().catch(() => {});
    sendAudioReady();
    return;
  }

  const now = audioContext.currentTime;
  const packetSeconds = frames / sampleRate;
  const delta = audioSequenceDelta(sequence, audioLastSequence);

  // Duplicate or stale packet: never replay it.
  if (delta === 0 || delta > 0x80000000) {
    sendAudioReady();
    return;
  }

  // A small sequence hole becomes silence instead of repeating/overlapping
  // audio. When a presented realtime video clock exists, audio follows that
  // same source capturedAt clock instead of independently chasing wall time.
  const gapPackets = Math.max(0, delta - 1);
  const desiredAhead = desiredAudioAheadSeconds(capturedAt);
  const ahead = audioNextTime - now;

  if (desiredAhead !== null) {
    const desiredStart = now + desiredAhead;
    const syncErrorSeconds =
      Number.isFinite(audioNextTime) ? desiredStart - audioNextTime : 0;
    audioSyncErrorMs = Math.round(syncErrorSeconds * 1000);

    if (
      !Number.isFinite(audioNextTime) ||
      Math.abs(audioSyncErrorMs) > AV_SYNC_HARD_RESET_MS ||
      gapPackets > AUDIO_MAX_SMALL_GAP_PACKETS
    ) {
      resetAudioSchedule(
        now,
        audioScheduledSources.size > 0,
        desiredAhead
      );
      audioSyncErrorMs = 0;
    } else {
      const nudge = Math.max(
        -AV_SYNC_NUDGE_PER_PACKET,
        Math.min(AV_SYNC_NUDGE_PER_PACKET, syncErrorSeconds * 0.18)
      );
      audioNextTime += nudge;
      if (gapPackets > 0) {
        audioNextTime += gapPackets * packetSeconds;
      }
    }
  } else if (
    !Number.isFinite(audioNextTime) ||
    ahead < AUDIO_MIN_AHEAD ||
    ahead > AUDIO_MAX_AHEAD ||
    gapPackets > AUDIO_MAX_SMALL_GAP_PACKETS
  ) {
    audioSyncErrorMs = 0;
    resetAudioSchedule(now, audioScheduledSources.size > 0);
  } else if (gapPackets > 0) {
    audioSyncErrorMs = 0;
    audioNextTime += gapPackets * packetSeconds;
  }

  audioLastSequence = sequence;
  audioLastCapturedAt = capturedAt;

  const pcmView = new DataView(buffer, 24);
  const samples = new Float32Array(frames);
  let sumSquares = 0;
  for (let i = 0; i < frames; i += 1) {
    const value = pcmView.getInt16(i * 2, true);
    const sample = value < 0 ? value / 32768 : value / 32767;
    samples[i] = sample;
    sumSquares += sample * sample;
  }
  audioPacketsReceived += 1;
  audioLastPcmRms = Math.sqrt(sumSquares / Math.max(1, frames));

  const audioBuffer = audioContext.createBuffer(1, frames, sampleRate);
  audioBuffer.copyToChannel(samples, 0);

  const gain = ensureAudioOutputGain();
  if (!gain) {
    sendAudioReady();
    return;
  }

  const source = audioContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(gain);
  audioScheduledSources.add(source);
  source.onended = () => {
    audioScheduledSources.delete(source);
    try { source.disconnect(); } catch {}
  };
  source.start(audioNextTime);
  audioNextTime += packetSeconds;

  sendAudioReady();
}

function ensureAudioSocket() {
  if (!audioEnabled || !state.audioUrl) return;
  if (
    audioSocket &&
    audioSocketUrl === state.audioUrl &&
    (audioSocket.readyState === WebSocket.OPEN ||
     audioSocket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  if (audioRetryTimer) {
    clearTimeout(audioRetryTimer);
    audioRetryTimer = null;
  }
  closeAudioSocket(false);

  const socket = new WebSocket(state.audioUrl);
  socket.binaryType = "arraybuffer";
  audioSocket = socket;
  audioSocketUrl = state.audioUrl;

  socket.addEventListener("open", () => {
    if (audioSocket !== socket) return;
    audioRetryCount = 0;
    setNudgeStatus("Sound connected");
    startAudioStatusTimer();
    sendAudioStatus();
    // The server opens with a multi-second credit window. Replenishment is
    // one-for-one after packets are admitted to the short local jitter queue.
    sendAudioReady();
  });

  socket.addEventListener("message", (event) => {
    if (audioSocket !== socket) return;
    if (event.data instanceof ArrayBuffer) {
      scheduleAudioPacket(event.data);
      return;
    }
    if (event.data instanceof Blob) {
      void event.data.arrayBuffer().then((buffer) => {
        if (audioSocket === socket) scheduleAudioPacket(buffer);
      });
    }
  });

  socket.addEventListener("close", (event) => {
    if (audioSocket !== socket) return;
    audioSocket = null;
    audioSocketUrl = "";
    stopAudioStatusTimer();

    if (event && event.code === 1012) {
      audioEnabled = false;
      render();
      return;
    }
    scheduleAudioReconnect();
  });

  socket.addEventListener("error", () => {});
}

function scheduleAudioReconnect() {
  if (!audioEnabled || !state.audioUrl || audioRetryTimer) return;
  audioRetryCount += 1;
  const delay = Math.min(
    5000,
    400 * (2 ** Math.min(audioRetryCount, 4))
  );
  audioRetryTimer = setTimeout(() => {
    audioRetryTimer = null;
    ensureAudioSocket();
  }, delay);
}

function closeAudioSocket(disable = false) {
  if (audioRetryTimer) {
    clearTimeout(audioRetryTimer);
    audioRetryTimer = null;
  }

  const socket = audioSocket;
  audioSocket = null;
  audioSocketUrl = "";
  if (socket) {
    try { socket.close(1000, "audio disabled"); } catch {}
  }

  if (audioContext) {
    const now = audioContext.currentTime;
    for (const source of [...audioScheduledSources]) {
      try { source.stop(now); } catch {}
    }
    audioScheduledSources.clear();
    if (audioOutputGain) {
      try { audioOutputGain.disconnect(); } catch {}
      audioOutputGain = null;
    }
  }
  audioLastSequence = null;
  audioNextTime = 0;
  if (disable) {
    stopAudioStatusTimer();
    releasePlaybackAudioSession();
    audioEnabled = false;
    const ctx = audioContext;
    audioContext = null;
    if (ctx) void ctx.close().catch(() => {});
  }
}

// iOS mutes Web Audio under the ring/silent switch (video elements are
// exempt), so live sound arrived but stayed silent. Ask for a media
// playback session; older WebKit only switches category while an
// <audio> element is playing, hence the silent loop.
function isIosHost() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function silentWavUrl() {
  const frames = 4000;
  const buffer = new ArrayBuffer(44 + frames * 2);
  const view = new DataView(buffer);
  const text = (offset, value) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + frames * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, frames * 2, true);
  return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
}

function claimPlaybackAudioSession() {
  try {
    if (navigator.audioSession) navigator.audioSession.type = "playback";
  } catch {}
  if (!isIosHost()) return;
  try {
    if (!audioSessionKeepAlive) {
      const keepAlive = document.createElement("audio");
      keepAlive.loop = true;
      keepAlive.playsInline = true;
      keepAlive.setAttribute("playsinline", "");
      keepAlive.src = silentWavUrl();
      audioSessionKeepAlive = keepAlive;
    }
    void audioSessionKeepAlive.play().catch(() => {});
  } catch {}
}

function releasePlaybackAudioSession() {
  setAudioSessionType("auto");
  if (!audioSessionKeepAlive) return;
  try { audioSessionKeepAlive.pause(); } catch {}
}

function setAudioSessionType(type) {
  try {
    if (navigator.audioSession) navigator.audioSession.type = type;
  } catch {}
}

// "playback" forbids capture ("AudioSession category is not compatible with
// audio capture"), so hold-to-talk switches to play-and-record while it
// records and hands the session back afterwards.
function claimRecordingAudioSession() {
  setAudioSessionType("play-and-record");
}

function restoreAudioSessionAfterRecording() {
  setAudioSessionType(audioEnabled ? "playback" : "auto");
}

async function toggleAudio() {
  if (audioEnabled) {
    writePref("tongping-live-sound", "0");
    closeAudioSocket(true);
    setNudgeStatus("Sound off");
    render();
    return;
  }

  if (!state.audioUrl) {
    setError("The audio channel is not ready");
    return;
  }

  try {
    const AudioContextCtor =
      window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      throw new Error("This host does not support AudioContext");
    }

    claimPlaybackAudioSession();
    if (!audioContext || audioContext.state === "closed") {
      audioContext = new AudioContextCtor({
        latencyHint: "interactive"
      });
      audioContext.onstatechange = () => {
        sendAudioStatus();
      };
    }
    await audioContext.resume();

    audioEnabled = true;
    writePref("tongping-live-sound", "1");
    audioPacketsReceived = 0;
    audioLastPcmRms = 0;
    audioLastCapturedAt = 0;
    audioSyncErrorMs = 0;
    audioLastSequence = null;
    audioScheduledSources.clear();
    audioOutputGain = null;
    audioNextTime = audioContext.currentTime + AUDIO_TARGET_AHEAD;
    ensureAudioOutputGain();
    setError("");
    setNudgeStatus("Connecting sound…");
    render();
    ensureAudioSocket();
  } catch (error) {
    audioEnabled = false;
    render();
    setError(error && error.message ? error.message : error);
  }
}

function closeLiveSocket(clearImage = true) {
  if (liveRetryTimer) {
    clearTimeout(liveRetryTimer);
    liveRetryTimer = null;
  }
  const socket = liveSocket;
  liveSocket = null;
  liveSocketUrl = "";
  pendingLivePacket = null;
  liveRenderScheduled = false;
  liveNewestCapturedAt = 0;
  liveRenderedCapturedAt = 0;
  liveRenderedAtMs = 0;
  if (clearImage) {
    $("liveCanvas").style.display = "none";
  }
  if (socket) {
    try { socket.close(1000, "view reset"); } catch {}
  }
  if (clearImage && $("frame").dataset.mode === "live") {
    $("frame").removeAttribute("src");
    $("frame").removeAttribute("data-mode");
  }
}

function structured(result) {
  if (!result || typeof result !== "object") return null;
  return result.structuredContent && typeof result.structuredContent === "object"
    ? result.structuredContent
    : null;
}
async function call(name, args) {
  if (!connected) throw new Error("MCP App bridge is not connected");
  const result = await app.callServerTool({ name, arguments: args || {} });
  if (result && result.isError) {
    const text = Array.isArray(result.content)
      ? result.content.map((x) => x && x.type === "text" ? x.text : "").filter(Boolean).join(" ")
      : "Tool call failed";
    throw new Error(text || "Tool call failed");
  }
  return structured(result);
}
function actorArgs(extra) {
  state.identity = normalizeIdentity($("identity").value);
  state.profile = normalizeProfile($("profile").value);
  return Object.assign({ identity: state.identity, profile: state.profile }, extra || {});
}

// Names the server gave AIs (their link names), learned from chat messages.
const aiNames = new Map();

function chatDisplayName(role, who) {
  if (role === "user") return userShownName();
  const identity = normalizeIdentity(who || state.identity);
  if (aiNames.has(identity)) return aiNames.get(identity);
  if (!who && state.aiName) return state.aiName;
  // claude.code → Claude·code, gpt.work → GPT·work: who, then which entry.
  const dot = identity.indexOf(".");
  const name = dot > 0 ? identity.slice(0, dot) : identity;
  const entry = dot > 0 ? identity.slice(dot + 1) : "";
  const shown = name === "claude" ? "Claude" : name === "gpt" ? "GPT" : name.charAt(0).toUpperCase() + name.slice(1);
  return entry ? shown + "·" + entry : shown;
}

function appendChatMessage(message) {
  if (!message || typeof message !== "object") return;
  const role =
    message.role === "assistant"
      ? "assistant"
      : message.role === "user"
        ? "user"
        : "";
  const text =
    typeof message.text === "string"
      ? message.text.trim()
      : "";
  if (!role || !text) return;

  const id =
    typeof message.id === "string" && message.id
      ? message.id
      : "local-" +
        Date.now().toString(36) +
        "-" +
        Math.random().toString(36).slice(2, 8);

  if (chatMessageIds.has(id)) {
    const existing = chatMessages.find((item) => item.id === id);
    if (existing && Number.isFinite(Number(message.seq))) {
      existing.seq = Number(message.seq);
    }
    return;
  }

  chatMessageIds.add(id);
  if (role === "assistant" && typeof message.name === "string" && message.name.trim()) {
    aiNames.set(
      typeof message.identity === "string" && message.identity ? normalizeIdentity(message.identity) : normalizeIdentity(state.identity),
      message.name.trim().slice(0, 24),
    );
  }
  chatMessages.push({
    id,
    role,
    identity:
      typeof message.identity === "string" && message.identity
        ? normalizeIdentity(message.identity)
        : normalizeIdentity(state.identity),
    text,
    seq: Number.isFinite(Number(message.seq))
      ? Number(message.seq)
      : 0,
    createdAt:
      typeof message.createdAt === "string"
        ? message.createdAt
        : new Date().toISOString()
  });

  if (chatMessages.length > 200) {
    const removed = chatMessages.splice(
      0,
      chatMessages.length - 200
    );
    for (const item of removed) {
      chatMessageIds.delete(item.id);
    }
  }
}

function renderChat(forceBottom = false) {
  const root = $("chatMessages");
  if (!root) return;

  const nearBottom =
    root.scrollHeight - root.scrollTop - root.clientHeight < 48;
  root.textContent = "";

  // A new card opens clean: history from before it stays in the room (the
  // AIs still read it) and is one tap away, but is folded by default.
  const earlier = chatShowEarlier
    ? []
    : chatMessages.filter((m) => m.seq > 0 && m.seq <= chatEarlierThroughSeq);
  const visible = earlier.length
    ? chatMessages.filter((m) => !(m.seq > 0 && m.seq <= chatEarlierThroughSeq))
    : chatMessages;
  if (earlier.length > 0) {
    const more = document.createElement("button");
    more.type = "button";
    more.className = "chatEarlier";
    more.textContent = "↑ View " + earlier.length + " earlier";
    more.addEventListener("click", () => {
      chatShowEarlier = true;
      renderChat(false);
    });
    root.appendChild(more);
  }

  if (visible.length === 0 && !chatPending) {
    const empty = document.createElement("div");
    empty.className = "chatEmpty";
    empty.textContent = "Messages from you and them appear here";
    root.appendChild(empty);
  }

  for (const message of visible) {
    const row = document.createElement("div");
    row.className =
      "chatRow " + message.role +
      (message.role === "assistant" ? " ai-" + message.identity : "");

    const bubble = document.createElement("div");
    bubble.className = "chatBubble";

    const who = document.createElement("span");
    who.className = "chatWho";
    who.textContent = chatDisplayName(message.role, message.identity);

    const body = document.createElement("span");
    body.textContent = message.text;

    bubble.appendChild(who);
    bubble.appendChild(body);
    row.appendChild(bubble);
    root.appendChild(row);
  }

  if (chatPending) {
    const row = document.createElement("div");
    row.className = "chatRow assistant";

    const bubble = document.createElement("div");
    bubble.className = "chatBubble";

    const who = document.createElement("span");
    who.className = "chatWho";
    who.textContent = chatDisplayName("assistant");

    const pending = document.createElement("span");
    pending.className = "chatPendingBubble";
    pending.setAttribute("aria-label", "Replying");

    for (let i = 0; i < 3; i += 1) {
      const dot = document.createElement("span");
      dot.className = "chatTypingDot";
      pending.appendChild(dot);
    }

    bubble.appendChild(who);
    bubble.appendChild(pending);
    // The mirror into this panel depends on the assistant remembering a
    // tool call; after a while, point to the host conversation instead of
    // leaving the viewer waiting.
    const waited = chatPendingSince > 0 ? Date.now() - chatPendingSince : 0;
    if (waited >= 30000) {
      const hint = document.createElement("span");
      hint.className = "chatPendingHint";
      hint.textContent = chatDisplayName("assistant") + " may have replied in the main conversation. Scroll down to check.";
      bubble.appendChild(hint);
    } else if (chatPendingSince > 0 && !chatHintTimer) {
      chatHintTimer = setTimeout(() => {
        chatHintTimer = null;
        if (chatPending) renderChat(false);
      }, 30000 - waited + 50);
    }
    row.appendChild(bubble);
    root.appendChild(row);
  }

  $("chatStatus").textContent =
    chatPending ? chatDisplayName("assistant") + " Replying…" : "";
  renderChatMembers();

  if (forceBottom || nearBottom) {
    requestAnimationFrame(() => {
      root.scrollTop = root.scrollHeight;
    });
  }
}

function chatEndpoint(extra = {}) {
  if (!state.chatUrl) return "";
  try {
    const url = new URL(state.chatUrl);
    url.searchParams.set(
      "identity",
      normalizeIdentity(state.identity)
    );
    for (const [key, value] of Object.entries(extra)) {
      url.searchParams.set(key, String(value));
    }
    return url.toString();
  } catch {
    return "";
  }
}

async function postChatUser(text, clientId) {
  const url = chatEndpoint();
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      cache: "no-store",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        text,
        clientId
      })
    });
  } catch {}
}

async function syncChat() {
  if (!connected || !state.chatUrl) return;

  const url = chatEndpoint({
    after: chatAfterSeq
  });
  if (!url) return;

  try {
    const response = await fetch(url, {
      cache: "no-store"
    });
    if (!response.ok) return;

    const data = await response.json();
    const messages = Array.isArray(data.messages)
      ? data.messages
      : [];

    let sawAssistant = false;
    const hostIdentity = normalizeIdentity(state.identity);

    for (const message of messages) {
      appendChatMessage(message);
      if (
        message &&
        message.role === "assistant" &&
        normalizeIdentity(message.identity || hostIdentity) === hostIdentity
      ) {
        sawAssistant = true;
      }
    }

    if (Number.isSafeInteger(data.clearedThroughSeq)) {
      dropClearedChat(data.clearedThroughSeq);
    }

    if (Array.isArray(data.muted)) {
      const next = data.muted.map((who) => normalizeIdentity(who)).sort().join(",");
      if (next !== [...chatMuted].sort().join(",")) {
        chatMuted.clear();
        for (const who of data.muted) chatMuted.add(normalizeIdentity(who));
        renderChatMembers();
      }
    }

    // First sync of this card: everything already in the room is "earlier".
    if (chatEarlierThroughSeq < 0 && Number.isSafeInteger(data.latestSeq)) {
      chatEarlierThroughSeq = data.latestSeq;
    }

    if (Number.isSafeInteger(data.latestSeq)) {
      chatAfterSeq = Math.max(
        chatAfterSeq,
        data.latestSeq
      );
    }

    if (sawAssistant) {
      chatPending = false;
      chatPendingSince = 0;
    } else if (
      chatPending &&
      chatPendingSince > 0 &&
      Date.now() - chatPendingSince > 120000
    ) {
      chatPending = false;
      chatPendingSince = 0;
    }

    if (messages.length > 0 || sawAssistant) {
      renderChat(true);
    }
  } catch {}
}

function startChatSync() {
  if (chatTimer) {
    clearInterval(chatTimer);
    chatTimer = null;
  }

  if (!connected || !state.chatUrl) return;

  void syncChat();
  chatTimer = setInterval(() => {
    void syncChat();
  }, 1200);
}

function resetChatLane() {
  if (chatTimer) {
    clearInterval(chatTimer);
    chatTimer = null;
  }

  chatAfterSeq = 0;
  chatEarlierThroughSeq = -1;
  chatShowEarlier = false;
  chatPending = false;
  chatPendingSince = 0;
  chatMessages.length = 0;
  chatMessageIds.clear();
  renderChat(true);
}

async function refreshFrame() {
  if (!connected || busy) return;
  busy = true;
  try {
    const data = await call(
      "browser_app_refresh",
      actorArgs({ appUiBuild: state.appUiBuild || "v93" }),
    );
    applyState(data);
    refreshImage();
    setError("");
  } catch (error) {
    setError(error && error.message ? error.message : error);
  } finally {
    busy = false;
  }
}
function checkLiveStall() {
  if (!connected || busy || companionModeActive || mediaModeActive) return;
  const now = Date.now();
  if (now - lastLivePacketAt < 5000 || now - liveStallRefreshAt < 20000) return;
  liveStallRefreshAt = now;
  void refreshFrame();
}

function startPolling() {
  if (stateTimer) clearInterval(stateTimer);
  if (frameTimer) clearInterval(frameTimer);
  stateTimer = null;
  frameTimer = null;

  if (state.externalLogin && state.externalLogin.active) {
    stateTimer = setInterval(() => { void refreshFrame(); }, 2500);
    return;
  }

  // Live mode is already a persistent bidirectional WebSocket. Do not keep
  // poking the host bridge every 20s; some ChatGPT hosts intermittently
  // surface those refresh calls as "Load failed" even while live is healthy.
  // Refresh the long-lived live ticket only occasionally.
  if (state.liveUrl) {
    stateTimer = setInterval(() => { void refreshFrame(); }, 60 * 1000);
    // Live frames stopping is how a local-login handoff shows up here, so a
    // stalled live view checks state instead of waiting out the minute.
    liveStallRefreshAt = Date.now();
    frameTimer = setInterval(checkLiveStall, 2000);
    return;
  }

  // Screenshot fallback still needs periodic refreshes.
  stateTimer = setInterval(() => { void refreshFrame(); }, 20000);
  frameTimer = setInterval(
    refreshImage,
    state.takeover ? 750 : 1800
  );
}
function manualLoginUrl() {
  const fallback = "https://example.com/";
  const raw = String(state.url || "").trim();
  if (!raw) return fallback;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return fallback;
    }
    if (
      parsed.hostname === "accounts.google.com" &&
      parsed.pathname.includes("/signin/rejected")
    ) {
      return fallback;
    }
    return parsed.toString();
  } catch {
    return fallback;
  }
}

async function toggleLocalLogin() {
  const externalActive = Boolean(state.externalLogin && state.externalLogin.active);
  if (!externalActive && !state.externalLoginEnabled) {
    setError("Local sign-in requires Windows Worker v28+.");
    return;
  }

  setError("");
  try {
    if (externalActive) {
      setNudgeStatus("Reconnecting TongPing…");
      const data = await call(
        "browser_app_external_login_finish",
        actorArgs()
      );
      applyState(data);
      liveFailed = false;
      liveSuperseded = false;
      liveRetryCount = 0;
      liveImageErrors = 0;
      refreshImage();
      scheduleLiveFrameResync();
      startPolling();
      setNudgeStatus("TongPing reconnected");
      return;
    }

    setNudgeStatus("Handing sign-in to the browser on your computer…");
    closeMediaSocket(true, true);
    closeLiveSocket();
    closeAudioSocket(true);
    audioEnabled = false;
    const data = await call(
      "browser_app_external_login_start",
      actorArgs({ url: manualLoginUrl() })
    );
    applyState(data);
    setNudgeStatus("Sign in on your computer, then close that browser window");
  } catch (error) {
    setError(error && error.message ? error.message : error);
  }
}

function enterRealtimeControlView() {
  closeMediaSocket(true, true);
  mediaModeActive = false;
  liveFailed = false;
  liveSuperseded = false;
  ensureLiveSocket();
}

async function navigate() {
  enterRealtimeControlView();
  const raw = $("address").value.trim();
  if (!raw) return;
  let url = raw;
  if (!/^https?:\\/\\//i.test(url)) url = "https://" + url;
  setError("");
  try {
    const data = await call("browser_app_navigate", actorArgs({ url }));
    applyState(data);
    refreshImage();
    scheduleLiveFrameResync();
    startPolling();
  } catch (error) {
    setError(error && error.message ? error.message : error);
  }
}
async function historyNavigate(direction) {
  enterRealtimeControlView();
  setError("");
  try {
    const data = await call(
      "browser_app_history",
      actorArgs({ direction })
    );
    applyState(data);
    refreshImage();
    scheduleLiveFrameResync();
    startPolling();
  } catch (error) {
    setError(error && error.message ? error.message : error);
  }
}

async function reloadPage() {
  enterRealtimeControlView();
  setError("");
  const button = $("refresh");
  button.disabled = true;
  button.classList.remove("done");
  button.classList.add("working");
  setNudgeStatus("Refreshing page…");
  try {
    const data = await call("browser_app_reload", actorArgs());
    applyState(data);
    const frame = $("frame");
    if (state.frameUrl) {
      frame.dataset.mode = "snapshot";
    }
    refreshImage();
    scheduleLiveFrameResync();
    const now = new Date();
    const stamp =
      String(now.getHours()).padStart(2, "0") + ":" +
      String(now.getMinutes()).padStart(2, "0") + ":" +
      String(now.getSeconds()).padStart(2, "0");
    setNudgeStatus("Refreshed · " + stamp);
    button.classList.remove("working");
    button.classList.add("done");
    setTimeout(() => {
      button.classList.remove("done");
      button.disabled = false;
    }, 700);
    startPolling();
  } catch (error) {
    button.classList.remove("working", "done");
    button.disabled = false;
    setNudgeStatus("Refresh failed");
    setError(error && error.message ? error.message : error);
  }
}

function hideContextMirror() {
  contextMenuOpen = false;
  contextMenuTarget = null;
  contextMenuPoint = null;
  $("contextMirror").classList.remove("on");
  $("contextMirror").replaceChildren();
}

function contextMenuViewportPoint(point) {
  const active = activeViewportElement();
  const frameRect = active.getBoundingClientRect();
  const wrapRect = $("viewportWrap").getBoundingClientRect();
  const width = Number(state.viewport.width || $("frame").naturalWidth || 0);
  const height = Number(state.viewport.height || $("frame").naturalHeight || 0);
  if (!width || !height || !frameRect.width || !frameRect.height) {
    return { x: 8, y: 8 };
  }
  return {
    x: frameRect.left - wrapRect.left + point.x / width * frameRect.width,
    y: frameRect.top - wrapRect.top + point.y / height * frameRect.height
  };
}

function addContextMenuButton(label, action, extraClass = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.dataset.contextAction = action;
  if (extraClass) button.className = extraClass;
  $("contextMirror").appendChild(button);
}

function addContextMenuSeparator() {
  const sep = document.createElement("div");
  sep.className = "sep";
  $("contextMirror").appendChild(sep);
}

function renderContextMirror(point, target) {
  const menu = $("contextMirror");
  menu.replaceChildren();

  addContextMenuButton("← Back", "back");
  addContextMenuButton("→ Forward", "forward");
  addContextMenuButton("↻ Refresh", "reload");

  const href =
    target && typeof target.href === "string" ? target.href : "";
  if (href) {
    addContextMenuSeparator();
    addContextMenuButton("Open link", "open-link");
    addContextMenuButton("Copy link address", "copy-link");
  }

  addContextMenuSeparator();
  addContextMenuButton("Cancel", "cancel", "muted");

  const pos = contextMenuViewportPoint(point);
  menu.style.left = Math.max(6, pos.x) + "px";
  menu.style.top = Math.max(6, pos.y) + "px";
  menu.classList.add("on");

  // Keep the mirror inside the visible viewport after it is laid out.
  requestAnimationFrame(() => {
    const wrap = $("viewportWrap").getBoundingClientRect();
    const rect = menu.getBoundingClientRect();
    const maxLeft = Math.max(6, wrap.width - rect.width - 6);
    const maxTop = Math.max(6, wrap.height - rect.height - 6);
    menu.style.left = Math.min(Math.max(6, pos.x), maxLeft) + "px";
    menu.style.top = Math.min(Math.max(6, pos.y), maxTop) + "px";
  });
}

async function openContextMirror(point) {
  contextMenuOpen = true;
  contextMenuPoint = { x: point.x, y: point.y };
  contextMenuTarget = null;
  renderContextMirror(point, null);
  setNudgeStatus("Context menu · Reading target…");

  try {
    const data = await call(
      "browser_app_context_info",
      actorArgs({ x: point.x, y: point.y })
    );
    const target =
      data && data.target && typeof data.target === "object"
        ? data.target
        : null;
    contextMenuTarget = target;
    if (contextMenuOpen && contextMenuPoint) {
      renderContextMirror(contextMenuPoint, contextMenuTarget);
      setNudgeStatus("Context menu open");
    }
  } catch (error) {
    // Navigation/reload/cancel still remain usable without target metadata.
    setError(error && error.message ? error.message : error);
  }

  // Native Chromium context menu is outside screencast. Once the mirrored
  // menu is ready, dismiss the native shell menu so only the in-card menu
  // remains relevant to the user.
  void key("Escape").catch(() => {});
}

async function copyText(text) {
  if (!text) throw new Error("No link to copy");
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand("copy");
  area.remove();
  if (!ok) throw new Error("Copy failed");
}

async function requestLiveFrameResync() {
  if (!liveSocket || liveSocket.readyState !== WebSocket.OPEN) return false;
  try {
    const result = await sendLiveCommand(
      { type: "resync_frame" },
      1800
    );
    return Boolean(result && result.resynced);
  } catch {
    return false;
  }
}

function scheduleLiveFrameResync() {
  void requestLiveFrameResync();
  setTimeout(() => { void requestLiveFrameResync(); }, 220);
  setTimeout(() => { void requestLiveFrameResync(); }, 850);
}

function sendLiveCommand(payload, timeoutMs = 5000) {
  if (!liveSocket || liveSocket.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error("Live control channel is not connected"));
  }

  const id = "cmd-" + (++liveCommandSeq);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      liveCommandPending.delete(id);
      reject(new Error("Live control timed out"));
    }, timeoutMs);

    liveCommandPending.set(id, { resolve, reject, timer });

    try {
      liveSocket.send(JSON.stringify({ ...payload, id }));
    } catch (error) {
      clearTimeout(timer);
      liveCommandPending.delete(id);
      reject(error);
    }
  });
}

function releaseLocalPointerCapture() {
  if (trackGesture) {
    try { $("trackpad").releasePointerCapture(trackGesture.id); } catch {}
    trackGesture = null;
  }
  if (leftPointerId !== null) {
    try { $("leftMouse").releasePointerCapture(leftPointerId); } catch {}
    leftPointerId = null;
  }
  if (rightPointerId !== null) {
    try { $("rightMouse").releasePointerCapture(rightPointerId); } catch {}
    rightPointerId = null;
  }
  $("trackpad").classList.remove("active");
  $("trackDot").classList.remove("on");
  $("leftMouse").classList.remove("pressed");
  $("rightMouse").classList.remove("pressed");
}

async function toggleTakeover() {
  const target = !state.takeover;
  if (target && companionModeActive) {
    stopCompanionPlayback(true);
  }
  const previousTakeover = state.takeover;
  const previousInputUrl = state.inputUrl;

  if (!state.controlUrl) {
    try {
      const data = await call(
        "browser_app_takeover",
        actorArgs({ takeover: target })
      );
      applyState(data);
      startPolling();
    } catch (error) {
      setError(error && error.message ? error.message : error);
    }
    return;
  }

  setError("");

  if (!target) {
    const cursor = remoteHeld ? ensureRemoteCursor() : null;

    releaseLocalPointerCapture();
    remoteHeld = false;
    hideContextMirror();
    $("leftMouse").classList.remove("pressed");
    $("rightMouse").classList.remove("pressed");
    $("pointerDot").classList.remove("on");
    setNudgeStatus("Returned to model");

    // Human-visible control changes immediately. Network confirmation runs
    // in the background so a slow worker/MCP round-trip cannot trap the UI.
    state.takeover = false;
    state.inputUrl = "";
    render();
    if (companionModeActive) ensureMediaSocket();

    if (cursor) {
      void postPointer("up", cursor).catch(() => {});
    }

    void (async () => {
      try {
        await sendLiveCommand({ type: "takeover", takeover: false });
        startPolling();
      } catch (error) {
        state.takeover = previousTakeover;
        state.inputUrl = previousInputUrl;
        render();
        setError(error && error.message ? error.message : error);
      }
    })();
    return;
  }

  // Taking control still waits for the signed input URL that the direct
  // pointer channel needs.
  state.takeover = true;
  enterRealtimeControlView();
  render();

  try {
    await sendLiveCommand({ type: "takeover", takeover: true });
    state.takeover = true;
    render();
    startPolling();
  } catch (error) {
    state.takeover = previousTakeover;
    state.inputUrl = previousInputUrl;
    render();
    setError(error && error.message ? error.message : error);
  }
}
async function sendHumanText() {
  if (!state.takeover) {
    setError("Select “Take control” first");
    return;
  }
  const text = $("humanText").value;
  if (!text) return;
  try {
    await call("browser_app_type", actorArgs({ text }));
    // The send arrow submits, like a phone keyboard's send key: typing
    // alone left search boxes and comment fields waiting for ↵.
    await call("browser_app_key", actorArgs({ key: "Enter" }));
    $("humanText").value = "";
    setTimeout(refreshImage, 120);
  } catch (error) {
    setError(error && error.message ? error.message : error);
  }
}
async function key(name) {
  if (!state.takeover) {
    setError("Select “Take control” first");
    return;
  }
  try {
    await call("browser_app_key", actorArgs({ key: name }));
    setTimeout(refreshImage, 120);
  } catch (error) {
    setError(error && error.message ? error.message : error);
  }
}
// Messages from the user and the other AIs since this card's AI last spoke, so
// its reply fits the group conversation.
function groupChatDigest() {
  const me = normalizeIdentity(state.identity);
  let start = 0;
  for (let i = chatMessages.length - 1; i >= 0; i -= 1) {
    const item = chatMessages[i];
    if (item.role === "assistant" && item.identity === me) {
      start = i + 1;
      break;
    }
  }
  const others = chatMessages
    .slice(start)
    .filter((item) => item.role === "assistant" && item.identity !== me)
    .slice(-12);
  if (others.length === 0) return "";
  return (
    " GROUP CHAT: this panel is a group chat " + userAiName() + " shares with other AIs. Since your last reply there, they said: " +
    others
      .map((item) => chatDisplayName("assistant", item.identity) + ": " + item.text.slice(0, 400))
      .join(" | ") +
    ". Reply as yourself only; never speak for them."
  );
}

function renderChatMembers() {
  const box = $("chatMembers");
  if (!box) return;
  const members = new Set(CHAT_MEMBERS);
  members.add(normalizeIdentity(state.identity));
  for (const item of chatMessages) {
    if (item.role === "assistant" && item.identity) members.add(item.identity);
  }
  box.textContent = "";
  for (const who of members) {
    const muted = chatMuted.has(who);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chatMember ai-" + who + (muted ? " muted" : "");
    const name = document.createElement("span");
    name.className = "chatMemberName";
    name.textContent = chatDisplayName("assistant", who);
    const bell = document.createElement("span");
    bell.className = "chatMemberBell";
    bell.innerHTML = muted ? CHAT_BELL_OFF_SVG : CHAT_BELL_SVG;
    button.appendChild(name);
    button.appendChild(bell);
    button.title = muted ? "Unmute" : "Mute";
    button.addEventListener("click", () => void setChatMuted(who, !muted));
    box.appendChild(button);
  }
}

const CHAT_BELL_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 2h-14z"/><path d="M10 21h4"/></svg>';
const CHAT_BELL_OFF_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 2h-14z"/><path d="M10 21h4M4 4l16 16"/></svg>';

let chatClearedThroughSeq = 0;
let chatClearArmTimer = null;

// Drop everything up to the server's clear point (cleared here or on another card).
function dropClearedChat(clearedThroughSeq) {
  if (!(clearedThroughSeq > chatClearedThroughSeq)) return;
  chatClearedThroughSeq = clearedThroughSeq;
  for (let i = chatMessages.length - 1; i >= 0; i -= 1) {
    const item = chatMessages[i];
    if (item.seq <= clearedThroughSeq) {
      chatMessageIds.delete(item.id);
      chatMessages.splice(i, 1);
    }
  }
  chatAfterSeq = Math.max(chatAfterSeq, clearedThroughSeq);
  renderChat(true);
}

function disarmChatClear() {
  const button = $("chatClear");
  if (chatClearArmTimer) {
    clearTimeout(chatClearArmTimer);
    chatClearArmTimer = null;
  }
  if (!button) return;
  button.classList.remove("armed");
  button.textContent = "Clear";
}

// First tap arms, a second tap within 3s clears (no browser dialogs in the host).
async function onChatClearClick() {
  const button = $("chatClear");
  if (!button || button.disabled) return;
  if (!button.classList.contains("armed")) {
    button.classList.add("armed");
    button.textContent = "Confirm clear?";
    chatClearArmTimer = setTimeout(disarmChatClear, 3000);
    return;
  }
  disarmChatClear();
  const url = chatEndpoint();
  if (!url) return;
  button.disabled = true;
  try {
    const response = await fetch(url, {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "clear" })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !Number.isSafeInteger(data.clearedThroughSeq)) throw new Error("clear failed");
    chatPending = false;
    chatPendingSince = 0;
    // Also drops this card's unsynced local echoes (seq 0).
    dropClearedChat(data.clearedThroughSeq);
  } catch {
    button.textContent = "Could not clear; try again";
    chatClearArmTimer = setTimeout(disarmChatClear, 2000);
  } finally {
    button.disabled = false;
  }
}

async function setChatMuted(who, muted) {
  const url = chatEndpoint();
  if (!url) return;
  if (muted) chatMuted.add(who);
  else chatMuted.delete(who);
  renderChatMembers();
  try {
    await fetch(url, {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "mute", identity: who, muted })
    });
  } catch {}
}

function chatRelayInstruction() {
  return (
    ". LOOK FIRST: if " + userAiName() + "'s message is about what is on screen, call browser_screenshot (or browser_look when they pressed “Show Everyone”) yourself before replying." +
    " [REQUIRED, do not skip] IN-APP CHAT RELAY: this user message originated inside the embedded TongPing group chat panel, and " + userAiName() + " reads your answer THERE. FIRST ACTION of your reply, before writing any text: call the MCP tool browser_app_chat_push exactly once with your reply, identity=" +
    state.identity +
    ", profile=" +
    state.profile +
    ", and text equal to the reply you are about to give. Only after that tool call succeeds, write the same reply in the host chat. A reply that is not pushed never reaches the panel." +
    // The old browser_read relay exists only on the personal server.
    (state.userName
      ? " If browser_app_chat_push is not available in your current tool catalog, use the existing browser_read tool as a compatibility relay instead: profile=" +
        state.profile +
        ", selector=\\"__tongping_chat_push__::" +
        state.identity +
        "::\\" followed immediately by the SAME final reply text, format=\\"text\\", maxChars=1000. Do not perform a real page read in that compatibility call. Do not use either relay for unrelated host-chat messages."
      : "")
  );
}

function canvasImageBlock(canvas, quality = 0.84) {
  try {
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    const marker = "base64,";
    const at = dataUrl.indexOf(marker);
    if (at < 0) return null;
    const data = dataUrl.slice(at + marker.length);
    if (!data) return null;
    return {
      type: "image",
      data,
      mimeType: "image/jpeg"
    };
  } catch {
    return null;
  }
}

function captureCurrentDisplayedFrame() {
  const video = $("mediaVideo");
  if (
    companionModeActive &&
    video &&
    video.style.display !== "none" &&
    video.readyState >= 2 &&
    video.videoWidth > 0 &&
    video.videoHeight > 0
  ) {
    try {
      const scale = Math.min(1, 640 / video.videoWidth);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        // iOS draws native-HLS video as an empty picture without throwing.
        const image = canvasLooksBlank(ctx, canvas) ? null : canvasImageBlock(canvas, 0.6);
        if (image) {
          return {
            image,
            source: "companion-presented-frame"
          };
        }
      }
    } catch {}
  }

  const live = $("liveCanvas");
  if (
    live &&
    live.style.display !== "none" &&
    live.width > 0 &&
    live.height > 0
  ) {
    const image = canvasImageBlock(live, 0.6);
    if (image) {
      return {
        image,
        source: "live-presented-frame"
      };
    }
  }

  const frame = $("frame");
  if (
    frame &&
    frame.style.display !== "none" &&
    frame.complete &&
    frame.naturalWidth > 0 &&
    frame.naturalHeight > 0
  ) {
    try {
      const scale = Math.min(1, 960 / frame.naturalWidth);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(frame.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(frame.naturalHeight * scale));
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
        const image = canvasImageBlock(canvas);
        if (image) {
          return {
            image,
            source: "snapshot-presented-frame"
          };
        }
      }
    } catch {}
  }

  return null;
}

function canvasLooksBlank(ctx, canvas) {
  try {
    const w = canvas.width;
    const h = canvas.height;
    const step = Math.max(1, Math.floor(Math.min(w, h) / 12));
    const data = ctx.getImageData(0, 0, w, h).data;
    let first = -1;
    for (let y = Math.floor(step / 2); y < h; y += step) {
      for (let x = Math.floor(step / 2); x < w; x += step) {
        const i = (y * w + x) * 4;
        if (data[i + 3] === 0) continue;
        const value = data[i] + data[i + 1] + data[i + 2];
        if (first < 0) first = value;
        else if (Math.abs(value - first) > 24) return false;
      }
    }
    return true;
  } catch {
    // A tainted canvas cannot be read back, so it cannot be shared either.
    return true;
  }
}

async function fetchCompanionFrameFallback() {
  try {
    const result = await app.callServerTool({
      name: "browser_companion_context",
      arguments: {
        profile: state.profile,
        frame: "always",
        lookbackSeconds: 0,
        subtitleSeconds: 0,
        audioSeconds: 1
      }
    });
    if (!result || result.isError) return null;
    const content = Array.isArray(result.content) ? result.content : [];
    const image = content.find(
      (item) =>
        item &&
        item.type === "image" &&
        typeof item.data === "string" &&
        item.data.length > 0
    );
    if (!image) return null;
    return {
      image: {
        type: "image",
        data: image.data,
        mimeType: image.mimeType || "image/jpeg"
      },
      source: "companion-buffer-frame"
    };
  } catch {
    return null;
  }
}

async function fetchCurrentFrameFallback() {
  const result = await app.callServerTool({
    name: "browser_screenshot",
    arguments: {
      profile: state.profile,
      fullPage: false
    }
  });

  if (result && result.isError) {
    throw new Error("Could not capture the current view");
  }

  const content = Array.isArray(result && result.content)
    ? result.content
    : [];
  const image = content.find(
    (item) =>
      item &&
      item.type === "image" &&
      typeof item.data === "string" &&
      item.data.length > 0
  );

  if (!image) {
    throw new Error("Current view unavailable");
  }

  return {
    image: {
      type: "image",
      data: image.data,
      mimeType:
        typeof image.mimeType === "string"
          ? image.mimeType
          : "image/jpeg"
    },
    source: "browser-screenshot-fallback"
  };
}

const WATCH_COLLECTION_ID_KEY =
  "tongping.watchCollection.id.v1";
const WATCH_COLLECTION_ENABLED_KEY =
  "tongping.watchCollection.enabled.v1";

function safeLocalGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

function randomCollectionId() {
  try {
    if (crypto && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID().replace(/-/g, "");
    }
  } catch {}
  return (
    "wc_" +
    Date.now().toString(36) +
    "_" +
    Math.random().toString(36).slice(2, 18) +
    Math.random().toString(36).slice(2, 18)
  );
}

function ensureWatchCollectionId() {
  if (watchCollectionId) return watchCollectionId;
  const stored = safeLocalGet(WATCH_COLLECTION_ID_KEY);
  if (
    stored &&
    /^[A-Za-z0-9_-]{24,96}$/.test(stored)
  ) {
    watchCollectionId = stored;
    return stored;
  }
  watchCollectionId = randomCollectionId();
  safeLocalSet(WATCH_COLLECTION_ID_KEY, watchCollectionId);
  return watchCollectionId;
}

function loadWatchCollectionLocalPrefs() {
  const stored = safeLocalGet(WATCH_COLLECTION_ID_KEY);
  if (
    stored &&
    /^[A-Za-z0-9_-]{24,96}$/.test(stored)
  ) {
    watchCollectionId = stored;
  }
  watchCollectionEnabled =
    safeLocalGet(WATCH_COLLECTION_ENABLED_KEY) === "1";
}

function setTicketToast(text) {
  $("ticketToast").textContent = text || "";
}

function watchCollectionEndpoint(extra = {}, operation = "read") {
  const signedUrl = operation === "write" ? state.watchCollectionWriteUrl : state.watchCollectionUrl;
  if (!signedUrl) return "";
  try {
    const url = new URL(signedUrl);
    for (const [key, value] of Object.entries(extra)) {
      url.searchParams.set(key, String(value));
    }
    return url.toString();
  } catch {
    return "";
  }
}

function ticketAbsoluteImageUrl(pathname) {
  if (!pathname || !state.watchCollectionUrl) return "";
  try {
    return new URL(pathname, state.watchCollectionUrl).toString();
  } catch {
    return "";
  }
}

async function watchCollectionRequest(action, extra = {}) {
  const collectionId =
    extra.collectionId ||
    watchCollectionId ||
    ensureWatchCollectionId();
  const url = watchCollectionEndpoint({}, "write");
  if (!url) throw new Error("Watch Collection service is not ready");

  const response = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      action,
      collectionId,
      ...extra
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    throw new Error(
      data && data.error
        ? data.error
        : "Watch Collection operation failed"
    );
  }

  watchCollection = data.collection || null;
  watchCollectionLoaded = true;
  if (watchCollection) {
    watchCollectionEnabled = watchCollection.enabled === true;
  }
  renderWatchCollectionState();
  return watchCollection;
}

async function syncWatchCollectionFromServer() {
  loadWatchCollectionLocalPrefs();
  if (
    !watchCollectionId ||
    !state.watchCollectionUrl
  ) {
    renderWatchCollectionState();
    return;
  }

  const url = watchCollectionEndpoint({
    collectionId: watchCollectionId
  });
  if (!url) return;

  try {
    const response = await fetch(url, {
      cache: "no-store"
    });
    if (!response.ok) return;
    const data = await response.json();
    if (!data || !data.ok) return;

    watchCollection = data.collection || null;
    watchCollectionLoaded = true;
    if (watchCollection) {
      watchCollectionEnabled =
        watchCollection.enabled === true;
      safeLocalSet(
        WATCH_COLLECTION_ENABLED_KEY,
        watchCollectionEnabled ? "1" : "0"
      );
    }
    renderWatchCollectionState();
  } catch {}
}

function renderWatchCollectionState() {
  // The hosted server keeps no Watch Collection yet: say so instead of a switch that fails.
  const collectionAvailable = Boolean(state.watchCollectionUrl);
  $("collectionSwitch").disabled = !collectionAvailable;
  $("ticketOpenLibrary").disabled = !collectionAvailable;
  if (!collectionAvailable) {
    $("collectionSwitch").classList.remove("on");
    $("collectionSwitch").setAttribute("aria-pressed", "false");
    $("collectionToggleHint").textContent = "Watch Collection is unavailable in this beta. Tickets can be downloaded but not collected yet.";
    return;
  }
  $("collectionSwitch").classList.toggle(
    "on",
    watchCollectionEnabled
  );
  $("collectionSwitch").setAttribute(
    "aria-pressed",
    watchCollectionEnabled ? "true" : "false"
  );
  $("collectionToggleHint").textContent =
    watchCollectionEnabled
      ? "Enabled: new tickets are saved automatically. Disabling this does not delete existing items."
      : "Off by default. Enable it to save finished tickets and required details.";

  const libraryOpen =
    $("ticketLibrary").classList.contains("on");
  if (libraryOpen) renderWatchLibrary();
}

function openTicketOverlay() {
  $("ticketOverlay").classList.add("on");
  $("ticketLibrary").classList.remove("on");
  $("ticketCreateView").style.display = "grid";
  renderWatchCollectionState();
}

function closeTicketOverlay() {
  $("ticketOverlay").classList.remove("on");
  ticketPrivacyPending = false;
  $("ticketPrivacy").classList.remove("on");
}

function showTicketPrivacy() {
  ticketPrivacyPending = true;
  $("ticketPrivacy").classList.add("on");
}

function hideTicketPrivacy() {
  ticketPrivacyPending = false;
  $("ticketPrivacy").classList.remove("on");
}

function platformLabel(urlText) {
  try {
    const host = new URL(urlText).hostname.toLowerCase();
    if (host.includes("douyin.com")) return "Douyin";
    if (host.includes("bilibili.com")) return "Bilibili";
    if (host.includes("xiaohongshu.com")) return "Xiaohongshu";
    if (host.includes("music.163.com")) return "NetEase Cloud Music";
    if (host.includes("youtube.com") || host.includes("youtu.be")) return "YouTube";
    return host.replace(/^www./, "") || "Web";
  } catch {
    return "Web";
  }
}

function ticketDateParts(date) {
  try {
    const formatter = new Intl.DateTimeFormat(
      navigator.language || "en",
      {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      }
    );
    return formatter.format(date);
  } catch {
    return date.toISOString().slice(0, 16).replace("T", " ");
  }
}

function loadImageBlock(image) {
  return new Promise((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () =>
      reject(new Error("Could not load ticket image"));
    element.src =
      "data:" +
      (image.mimeType || "image/jpeg") +
      ";base64," +
      image.data;
  });
}

function drawImageCover(ctx, image, x, y, width, height) {
  const iw = image.naturalWidth || image.width;
  const ih = image.naturalHeight || image.height;
  if (!iw || !ih) return;
  const scale = Math.max(width / iw, height / ih);
  const sw = width / scale;
  const sh = height / scale;
  const sx = Math.max(0, (iw - sw) / 2);
  const sy = Math.max(0, (ih - sh) / 2);
  ctx.drawImage(
    image,
    sx,
    sy,
    sw,
    sh,
    x,
    y,
    width,
    height
  );
}

function wrapCanvasText(
  ctx,
  text,
  maxWidth,
  maxLines = 4
) {
  const chars = Array.from(String(text || ""));
  const lines = [];
  let line = "";

  for (const char of chars) {
    const next = line + char;
    // Closing punctuation never starts a line: let it hang on this one.
    if (line && "，。、！？：；,.!?:;”’」』）)》】…".indexOf(char) >= 0) {
      line = next;
      continue;
    }
    if (
      line &&
      ctx.measureText(next).width > maxWidth
    ) {
      lines.push(line);
      line = char;
      if (lines.length >= maxLines) break;
    } else {
      line = next;
    }
  }

  if (
    line &&
    lines.length < maxLines
  ) {
    lines.push(line);
  }

  if (
    chars.join("") !== lines.join("") &&
    lines.length > 0
  ) {
    let last = lines[lines.length - 1];
    while (
      last.length > 1 &&
      ctx.measureText(last + "…").width > maxWidth
    ) {
      last = last.slice(0, -1);
    }
    lines[lines.length - 1] = last + "…";
  }

  return lines;
}

const TICKET_PALETTES = {
  candy: { bg: "#fff8fb", ink: "#4a3f48", sub: "#9a8a97", accent: "#d17f9f", accent2: "#b89be0", line: "rgba(74,63,72,.18)" },
  mist: { bg: "#fbf5f3", ink: "#3d3336", sub: "#8e7d80", accent: "#b27f7b", accent2: "#8fa38a", line: "rgba(61,51,54,.18)" },
  sage: { bg: "#f5f7f3", ink: "#2f3833", sub: "#7a867e", accent: "#6e8a7c", accent2: "#7f97a8", line: "rgba(47,56,51,.18)" },
  dusk: { bg: "#2b2830", ink: "#ece4e2", sub: "#a39a9f", accent: "#e0b7b1", accent2: "#9fbfa8", line: "rgba(236,228,226,.22)" },
  night: { bg: "#15161b", ink: "#ede6d8", sub: "#9b958a", accent: "#c9a96e", accent2: "#e8d3a6", line: "rgba(237,230,216,.22)" },
  claude: { bg: "#fbf6ef", ink: "#3d2f28", sub: "#9a8578", accent: "#d97757", accent2: "#c15f3c", line: "rgba(61,47,40,.18)" },
  mint: { bg: "#121415", ink: "#ece8de", sub: "#8e958f", accent: "#8fd3b8", accent2: "#ece8de", line: "rgba(236,232,222,.18)" }
};

function cleanTicketTitle(pageTitle) {
  let title = String(pageTitle || "").trim();
  const dash = title.indexOf(" - ");
  if (dash > 0) title = title.slice(0, dash);
  const hash = title.indexOf(" #");
  if (hash > 0) title = title.slice(0, hash);
  const colon = title.indexOf(" : ");
  if (colon > 0) title = title.slice(0, colon);
  title = title.trim();
  if (title.length < 2 || title.startsWith("Douyin Picks") || title === "Bilibili") return "";
  return Array.from(title).slice(0, 40).join("");
}

// Human-readable, per-device daily sequence: MB-20260926-001.
function nextTicketNo(date) {
  const day =
    String(date.getFullYear()) +
    String(date.getMonth() + 1).padStart(2, "0") +
    String(date.getDate()).padStart(2, "0");
  const key = "tongping-ticket-seq-" + day;
  let seq = Number(readPref(key) || "0");
  if (!Number.isFinite(seq) || seq < 0) seq = 0;
  // v90: the collection is shared by every card, so continue after the
  // highest number already saved today instead of this sandbox's counter.
  const prefix = "MB-" + day + "-";
  const saved = (watchCollection && Array.isArray(watchCollection.tickets))
    ? watchCollection.tickets
    : [];
  for (const ticket of saved) {
    const id = String((ticket && ticket.id) || "");
    if (!id.startsWith(prefix)) continue;
    const n = Number(id.slice(prefix.length, prefix.length + 3));
    if (Number.isFinite(n) && n > seq) seq = n;
  }
  seq += 1;
  writePref(key, String(seq));
  return "MB-" + day + "-" + String(seq).padStart(3, "0");
}

function ticketDotDate(date) {
  return (
    date.getFullYear() + "." +
    String(date.getMonth() + 1).padStart(2, "0") + "." +
    String(date.getDate()).padStart(2, "0") + " · " +
    String(date.getHours()).padStart(2, "0") + ":" +
    String(date.getMinutes()).padStart(2, "0")
  );
}

function roundedRectPath(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function drawTicketBarcode(ctx, ticketNo, x, y, width, height, color) {
  let hash = 2166136261;
  for (const char of ticketNo) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  ctx.fillStyle = color;
  let cursor = x;
  while (cursor < x + width) {
    hash = Math.imul(hash ^ (hash >>> 13), 2246822507) >>> 0;
    const bar = 2 + (hash % 5);
    const gap = 2 + ((hash >>> 8) % 4);
    if (cursor + bar > x + width) break;
    ctx.fillRect(cursor, y, bar, height);
    cursor += bar + gap;
  }
}

// Deterministic ticket stub (3:1, drawn at 2x): the frame, the session's
// real metadata, an already-played quote and mood when available.
async function buildLocalWatchTicket(captured, context) {
  const source = captured ? await loadImageBlock(captured.image).catch(() => null) : null;
  const palette = TICKET_PALETTES[currentSkin] || TICKET_PALETTES.candy;
  const W = 1800;
  const H = 600;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create ticket canvas");

  const info = context || {};
  const platform = platformLabel(state.url);
  const title = cleanTicketTitle(info.pageTitle || state.title) || platform + " · Watch record";
  const quote = typeof info.quote === "string" && info.quote ? info.quote : "";
  const mood = typeof info.mood === "string" && info.mood ? info.mood : "";
  const watchedAt = new Date();
  const ticketNo = nextTicketNo(watchedAt);
  const pair = userShownName() + " × " + chatDisplayName("assistant");
  const sans = "-apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif";
  const serif = "Didot, 'Bodoni 72', 'Songti SC', Georgia, serif";
  const perfX = 1390;

  // Paper with rounded corners and two tear notches on the perforation.
  ctx.save();
  roundedRectPath(ctx, 0, 0, W, H, 40);
  ctx.fillStyle = palette.bg;
  ctx.fill();
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.arc(perfX, 0, 28, 0, Math.PI * 2);
  ctx.arc(perfX, H, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Frame window.
  ctx.save();
  roundedRectPath(ctx, 36, 36, 640, 528, 26);
  ctx.clip();
  if (source) {
    drawImageCover(ctx, source, 36, 36, 640, 528);
  } else {
    const empty = ctx.createLinearGradient(36, 36, 676, 564);
    empty.addColorStop(0, palette.accent);
    empty.addColorStop(1, palette.accent2);
    ctx.fillStyle = empty;
    ctx.fillRect(36, 36, 640, 528);
    ctx.fillStyle = "rgba(255,255,255,.85)";
    ctx.font = "italic 600 64px " + serif;
    ctx.textAlign = "center";
    ctx.fillText("Watched", 356, 290);
    ctx.fillText("together", 356, 360);
    ctx.textAlign = "left";
  }
  ctx.restore();

  // Main information.
  let y = 92;
  ctx.fillStyle = palette.accent;
  ctx.font = "700 22px " + sans;
  ctx.fillText("WATCH MEMORY TICKET", 724, y);

  y += 62;
  ctx.fillStyle = palette.ink;
  ctx.font = "750 44px " + sans;
  const titleLines = wrapCanvasText(ctx, title, 620, 2);
  titleLines.forEach((line, index) => ctx.fillText(line, 724, y + index * 54));
  y += (titleLines.length - 1) * 54 + 62;

  ctx.fillStyle = palette.accent;
  ctx.font = "italic 600 38px " + serif;
  ctx.fillText(pair, 724, y);

  y += 58;
  ctx.fillStyle = palette.sub;
  ctx.font = "600 18px " + sans;
  ctx.fillText("PLATFORM", 724, y);
  ctx.fillText("WATCHED AT", 924, y);
  ctx.fillStyle = palette.ink;
  ctx.font = "650 26px " + sans;
  ctx.fillText(platform, 724, y + 36);
  ctx.fillText(ticketDotDate(watchedAt), 924, y + 36);
  y += 36;

  if (quote) {
    y += 64;
    ctx.fillStyle = palette.ink;
    ctx.font = "italic 600 30px " + sans;
    const quoteLines = wrapCanvasText(ctx, "“" + quote + "”", 620, 2);
    quoteLines.forEach((line, index) => ctx.fillText(line, 724, y + index * 40));
    y += (quoteLines.length - 1) * 40;
  }
  if (mood) {
    y += 48;
    ctx.fillStyle = palette.sub;
    ctx.font = "600 22px " + sans;
    ctx.fillText("Mood · " + mood, 724, y);
  }

  // WATCHED TOGETHER stamp.
  ctx.save();
  ctx.translate(1236, 508);
  ctx.rotate(-0.12);
  ctx.strokeStyle = palette.accent;
  ctx.fillStyle = palette.accent;
  ctx.lineWidth = 4;
  roundedRectPath(ctx, -118, -40, 236, 80, 14);
  ctx.stroke();
  ctx.lineWidth = 1.5;
  roundedRectPath(ctx, -108, -30, 216, 60, 10);
  ctx.stroke();
  ctx.font = "800 22px " + sans;
  ctx.textAlign = "center";
  ctx.fillText("WATCHED", 0, -4);
  ctx.fillText("TOGETHER", 0, 22);
  ctx.restore();

  // Perforation.
  ctx.save();
  ctx.setLineDash([12, 12]);
  ctx.strokeStyle = palette.line;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(perfX, 44);
  ctx.lineTo(perfX, H - 44);
  ctx.stroke();
  ctx.restore();

  // Stub.
  ctx.fillStyle = palette.sub;
  ctx.font = "700 20px " + sans;
  ctx.fillText("ADMIT TWO", 1432, 92);
  ctx.fillStyle = palette.ink;
  ctx.font = "700 30px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(ticketNo, 1432, 150);
  ctx.fillStyle = palette.sub;
  ctx.font = "600 20px " + sans;
  ctx.fillText(ticketDotDate(watchedAt), 1432, 192);
  ctx.fillText(platform, 1432, 226);
  drawTicketBarcode(ctx, ticketNo, 1432, 380, 330, 120, palette.ink);
  ctx.font = "600 16px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(ticketNo.split("-").join(" "), 1432, 532);

  const dataUrl = canvas.toDataURL("image/png");

  // JPEG copy (white behind the notches) for the collection and the AI.
  const flat = document.createElement("canvas");
  flat.width = W;
  flat.height = H;
  const flatCtx = flat.getContext("2d");
  flatCtx.fillStyle = "#ffffff";
  flatCtx.fillRect(0, 0, W, H);
  flatCtx.drawImage(canvas, 0, 0);
  const jpegUrl = flat.toDataURL("image/jpeg", 0.9);
  const marker = "base64,";
  const at = jpegUrl.indexOf(marker);
  if (at < 0) throw new Error("Ticket export failed");

  return {
    id: ticketNo,
    ticketNo,
    title,
    platform,
    quote,
    mood,
    url: state.url || "",
    watchedAt: watchedAt.toISOString(),
    imageMimeType: "image/jpeg",
    imageBase64: jpegUrl.slice(at + marker.length),
    dataUrl,
    source: captured ? captured.source : "none"
  };
}

function renderCurrentWatchTicket() {
  if (!currentWatchTicket) {
    $("ticketPreviewWrap").classList.remove("ready");
    $("ticketPreview").removeAttribute("src");
    $("ticketMetaTitle").textContent = "Not created yet";
    $("ticketMetaDetail").textContent =
      watchCollectionEnabled
        ? "It will be saved to Watch Collection after creation"
        : "Not saved by default";
    return;
  }

  $("ticketPreview").src =
    currentWatchTicket.dataUrl;
  $("ticketPreviewWrap").classList.add("ready");
  $("ticketMetaTitle").textContent =
    currentWatchTicket.ticketNo + " · " + currentWatchTicket.title;
  $("ticketMetaDetail").textContent =
    currentWatchTicket.platform +
    " · " +
    ticketDateParts(
      new Date(currentWatchTicket.watchedAt)
    ) +
    (watchCollectionEnabled
      ? " · Auto-save enabled"
      : " · Not saved by default");
}

async function saveCurrentTicketIfEnabled() {
  if (
    !watchCollectionEnabled ||
    !currentWatchTicket
  ) {
    return false;
  }
  ensureWatchCollectionId();
  await watchCollectionRequest(
    "add",
    {
      ticket: {
        id: currentWatchTicket.id,
        title: currentWatchTicket.title,
        platform: currentWatchTicket.platform,
        url: currentWatchTicket.url,
        watchedAt: currentWatchTicket.watchedAt,
        imageMimeType:
          currentWatchTicket.imageMimeType,
        imageBase64:
          currentWatchTicket.imageBase64
      }
    }
  );
  setTicketToast("Saved to Watch Collection");
  return true;
}

async function generateWatchTicket() {
  if (watchTicketBusy || !connected) return;
  watchTicketBusy = true;
  render();
  setError("");
  openTicketOverlay();
  setTicketToast("Capturing the frame you see…");

  try {
    // Frame first (what they are looking at right now), then the session's
    // context; a missing frame, quote or mood never blocks the ticket.
    let captured = captureCurrentDisplayedFrame();
    if (!captured) {
      captured = await fetchCurrentFrameFallback().catch(() => null);
    }
    const context = await fetchTicketContext();

    currentWatchTicket =
      await buildLocalWatchTicket(captured, context);
    renderCurrentWatchTicket();

    if (watchCollectionEnabled) {
      await saveCurrentTicketIfEnabled();
    }
    // The ticket stays local; nothing is sent to the AI.
    setTicketToast(
      watchCollectionEnabled
        ? "Ticket created and saved to Watch Collection"
        : "Ticket created (not saved)"
    );
  } catch (error) {
    setTicketToast("");
    setError(
      error && error.message
        ? error.message
        : error
    );
  } finally {
    watchTicketBusy = false;
    render();
  }
}

async function fetchTicketContext() {
  try {
    const data = await call("browser_app_ticket_context", actorArgs());
    if (!data || typeof data !== "object") return null;
    // While companion lags the PC, the page may already be on the next
    // video: if its length disagrees with what is on screen, its title,
    // quote and mood belong to another clip.
    if (
      companionModeActive &&
      companionSourceDuration !== null &&
      typeof data.durationSeconds === "number" &&
      Math.abs(data.durationSeconds - companionSourceDuration) > 1
    ) {
      return { pageTitle: "", quote: null, mood: null };
    }
    return data;
  } catch {
    return null;
  }
}

// The embedded app can neither download nor long-press-save images, so host
// the PNG briefly and open it in the system browser, where it can be saved.
async function downloadCurrentTicket() {
  if (!currentWatchTicket) return;
  const ticket = currentWatchTicket;
  const pngBase64 = ticket.dataUrl.slice(ticket.dataUrl.indexOf("base64,") + 7);
  setTicketToast("Preparing image…");
  try {
    const data = await call("browser_app_image_link", actorArgs({
      imageBase64: pngBase64,
      mimeType: "image/png",
      name: ticket.ticketNo
    }));
    const url = data && typeof data.url === "string" ? data.url : "";
    if (!url) throw new Error("no link");
    let opened = false;
    if (app && typeof app.openLink === "function") {
      const result = await app.openLink({ url }).catch(() => ({ isError: true }));
      opened = !(result && result.isError);
    }
    setTicketToast(
      opened
        ? "Opened in your browser. Press and hold the image to save it (link valid for 30 minutes)."
        : "The browser did not open automatically. Copy this link into Safari: " + url
    );
  } catch {
    setTicketToast("Image is not ready. Try again shortly.");
  }
}

async function enableWatchCollection() {
  ensureWatchCollectionId();
  await watchCollectionRequest("enable");
  watchCollectionEnabled = true;
  safeLocalSet(
    WATCH_COLLECTION_ENABLED_KEY,
    "1"
  );
  hideTicketPrivacy();
  renderWatchCollectionState();
  renderCurrentWatchTicket();
  setTicketToast("Watch Collection enabled");

  if (currentWatchTicket) {
    await saveCurrentTicketIfEnabled();
  }
}

async function disableWatchCollection() {
  if (!watchCollectionId) {
    watchCollectionEnabled = false;
    safeLocalSet(
      WATCH_COLLECTION_ENABLED_KEY,
      "0"
    );
    renderWatchCollectionState();
    return;
  }

  await watchCollectionRequest("disable");
  watchCollectionEnabled = false;
  safeLocalSet(
    WATCH_COLLECTION_ENABLED_KEY,
    "0"
  );
  renderWatchCollectionState();
  renderCurrentWatchTicket();
  setTicketToast(
    "Auto-save disabled; existing collection items were not deleted"
  );
}

function renderWatchLibrary() {
  const root = $("ticketLibraryList");
  root.textContent = "";

  const tickets =
    watchCollection &&
    Array.isArray(watchCollection.tickets)
      ? watchCollection.tickets
      : [];

  if (tickets.length === 0) {
    const empty = document.createElement("div");
    empty.className = "ticketLibraryEmpty";
    empty.textContent =
      "Your Watch Collection is empty. Enable collection to save new tickets here automatically.";
    root.appendChild(empty);
    return;
  }

  for (
    const ticket of [...tickets].reverse()
  ) {
    const row = document.createElement("div");
    row.className = "ticketLibraryItem";

    const image = document.createElement("img");
    image.className = "ticketLibraryThumb";
    image.alt = ticket.title || "Watch ticket";
    image.src =
      ticketAbsoluteImageUrl(ticket.imageUrl);

    const info = document.createElement("div");
    info.className = "ticketLibraryInfo";

    const title = document.createElement("strong");
    title.textContent =
      ticket.title || "Untitled ticket";

    const meta = document.createElement("span");
    meta.textContent =
      (ticket.platform || "Web") +
      " · " +
      ticketDateParts(
        new Date(ticket.watchedAt)
      );

    info.appendChild(title);
    info.appendChild(meta);

    const remove = document.createElement("button");
    remove.className = "ticketDelete";
    remove.textContent = "×";
    remove.title = "Delete this ticket";
    remove.dataset.ticketId = ticket.id;

    row.appendChild(image);
    row.appendChild(info);
    row.appendChild(remove);
    root.appendChild(row);
  }
}

async function openWatchLibrary() {
  $("ticketCreateView").style.display = "none";
  $("ticketLibrary").classList.add("on");
  $("ticketSheetTitle").textContent = "My Watch Collection";
  $("ticketSheetSub").textContent =
    watchCollectionEnabled
      ? "Collection mode enabled"
      : "Collection mode disabled · Existing items retained";

  if (
    watchCollectionId &&
    state.watchCollectionUrl
  ) {
    await syncWatchCollectionFromServer();
  } else {
    renderWatchLibrary();
  }
}

function closeWatchLibrary() {
  $("ticketLibrary").classList.remove("on");
  $("ticketCreateView").style.display = "grid";
  $("ticketSheetTitle").textContent =
    "Watch Memory Ticket";
  $("ticketSheetSub").textContent =
    "A moment you actually watched";
  renderCurrentWatchTicket();
}

async function showCurrentFrameToAi() {
  if (showToAiBusy || !connected) return;

  showToAiBusy = true;
  render();
  setError("");

  // Camera on: “Show Everyone” shares their (effects-rendered) self instead of the page.
  const cameraShot = cameraOn ? captureCameraFrame(960) : null;
  const text = cameraShot
    ? "👀 Shared my camera view with everyone (use browser_look to view)"
    : "👀 Shared the current view with everyone (use browser_look to view)";
  const clientId =
    "look-" +
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 9);

  try {
    let captured = cameraShot ? { image: cameraShot, source: "camera" } : captureCurrentDisplayedFrame();
    if (!captured && companionModeActive) {
      // Use the viewer's frame from the server's Watch Together buffer, at their playback point;
      // the computer's screenshot runs ahead and could spoil what comes next.
      captured = await fetchCompanionFrameFallback();
    }
    if (!captured) {
      captured = await fetchCurrentFrameFallback();
    }

    appendChatMessage({
      id: clientId,
      role: "user",
      text,
      createdAt: new Date().toISOString()
    });
    chatPending = true;
    chatPendingSince = Date.now();
    renderChat(true);
    void postChatUser(text, clientId);

    // Hosts drop images an app sends; park the frame server-side so the
    // assistant can fetch it with browser_look (tool results do arrive).
    await call("browser_app_look_share", actorArgs({
      imageBase64: captured.image.data,
      mimeType: captured.image.mimeType || "image/jpeg",
      url: cameraShot ? "" : state.url || "",
      mode: cameraShot ? "camera" : companionModeActive ? "companion" : "live"
    }));

    await app.updateModelContext({
      content: [
        {
          type: "text",
          text:
            "TongPing context: identity=" +
            state.identity +
            ", profile=" +
            state.profile +
            ", url=" +
            (state.url || "(none)") +
            ". USER_EXPLICIT_VISUAL_CHECK: " + userAiName() + " pressed “Show Everyone”. The exact frame they are pointing at is NOT attached here; call the TongPing tool browser_look with profile=" +
            state.profile +
            " to see it, then respond naturally to what they are pointing out. Do not answer before looking." +
            chatRelayInstruction()
        }
      ]
    });

    const result = await app.sendMessage({
      role: "user",
      content: [
        {
          type: "text",
          text:
            "[TongPing · System] " + userZhName() + " pressed “Show Everyone”. Call browser_look with profile=" +
      state.profile + " to inspect the exact frame they pointed at, then call browser_app_chat_push to post your response into the group chat before repeating it in your own chat."
        }
      ]
    });

    if (result && result.isError) {
      throw new Error("The host refused to send the view");
    }

    setNudgeStatus("Asked " + chatDisplayName("assistant") + " to look");
  } catch (error) {
    chatPending = false;
    chatPendingSince = 0;
    renderChat(true);
    setError(
      error && error.message
        ? error.message
        : error
    );
  } finally {
    showToAiBusy = false;
    render();
  }
}

// ----- “Let Them See You”: their camera with face effects, AIs look when they want -----
const CAMERA_FX_BASE = ${JSON.stringify(baseOrigin + "/assets/camera-fx/")};
const CAMERA_FX_VERSION = "3";
const CAMERA_UPLOAD_MS = 3000;
const CAMERA_NOTE = "Camera on · They can look when they want";
const CAMERA_LOOK_NAMES = [
  ["soft", "Beauty"], ["none", "Original"], ["cat", "Cat"], ["bunny", "Bunny"],
  ["bird", "Ostrich"], ["frog", "Frog"], ["hearts", "Hearts"], ["stars", "Stars"]
];
const CAMERA_EYE_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.8 12s3.4-5.4 9.2-5.4S21.2 12 21.2 12s-3.4 5.4-9.2 5.4S2.8 12 2.8 12z"/><circle cx="12" cy="12" r="2.6"/></svg>';
let cameraOn = false;
let cameraBusy = false;
let cameraUploadTimer = null;
let cameraLook = "soft";
let cameraOpenedAt = 0;
let cameraLastLookAt = "";
let cameraLookedTimer = null;
let cameraFxLoading = null;

function loadCameraScript(name) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = CAMERA_FX_BASE + name + ".js?v=" + CAMERA_FX_VERSION;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Effects script failed to load"));
    document.head.appendChild(script);
  });
}

function loadCameraFx() {
  if (window.TongpingCameraFx) return Promise.resolve();
  if (!cameraFxLoading) {
    cameraFxLoading = loadCameraScript("geometry")
      .then(() => loadCameraScript("engine"))
      .catch((error) => {
        cameraFxLoading = null;
        throw error;
      });
  }
  return cameraFxLoading;
}

function renderCameraLooks() {
  const root = $("cameraLooks");
  root.textContent = "";
  for (const [id, label] of CAMERA_LOOK_NAMES) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.classList.toggle("on", id === cameraLook);
    button.addEventListener("click", () => {
      cameraLook = id;
      writePref("tongping-camera-look", id);
      if (window.TongpingCameraFx) window.TongpingCameraFx.setLook(id);
      renderCameraLooks();
    });
    root.appendChild(button);
  }
}

function captureCameraFrame(maxSide) {
  const canvas = $("cameraCanvas");
  if (!cameraOn || !canvas.width || !canvas.height) return null;
  const scale = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
  const shot = document.createElement("canvas");
  shot.width = Math.max(1, Math.round(canvas.width * scale));
  shot.height = Math.max(1, Math.round(canvas.height * scale));
  const ctx = shot.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(canvas, 0, 0, shot.width, shot.height);
  return canvasImageBlock(shot, 0.72);
}

function flashCameraLooked(by) {
  const note = $("cameraLooked");
  note.innerHTML = CAMERA_EYE_SVG;
  const text = document.createElement("span");
  text.textContent = chatDisplayName("assistant", by) + " looked at you";
  note.appendChild(text);
  note.classList.add("on");
  if (cameraLookedTimer) clearTimeout(cameraLookedTimer);
  cameraLookedTimer = setTimeout(() => note.classList.remove("on"), 3200);
}

function handleCameraLook(look) {
  if (!look || typeof look.at !== "string" || look.at === cameraLastLookAt) return;
  cameraLastLookAt = look.at;
  // A look from before this camera session is old news.
  if (Date.parse(look.at) < cameraOpenedAt) return;
  flashCameraLooked(look.by);
}

async function uploadCameraFrame() {
  if (!cameraOn) return;
  const shot = captureCameraFrame(480);
  try {
    const result = await call("browser_app_camera_frame", actorArgs({
      active: true,
      imageBase64: shot ? shot.data : "",
      mimeType: "image/jpeg"
    }));
    if (cameraOn) handleCameraLook(result && result.lastLook);
  } catch {}
}

function postCameraNotice(text) {
  const clientId = "camera-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
  appendChatMessage({ id: clientId, role: "user", text, createdAt: new Date().toISOString() });
  renderChat(true);
  void postChatUser(text, clientId);
}

function cameraErrorMessage(error) {
  const name = error && error.name ? String(error.name) : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera unavailable: this app blocks camera access or permission has not been granted";
  }
  if (name === "NotFoundError") return "No camera found";
  return "Could not open camera: " + (error && error.message ? error.message : String(error || ""));
}

function renderCameraToggle() {
  $("shell").classList.toggle("cameraOn", cameraOn || cameraBusy);
  $("cameraToggle").classList.toggle("on", cameraOn || cameraBusy);
  $("cameraToggle").title = cameraOn ? "Turn off camera" : "Let Them See You";
  $("cameraToggle").setAttribute("aria-label", cameraOn ? "Turn off camera" : "Let Them See You");
}

async function openCamera() {
  if (cameraBusy || cameraOn) return;
  cameraBusy = true;
  renderCameraToggle();
  renderCameraLooks();
  $("cameraNote").textContent = "Opening camera…";
  if (!screenCollapsed) setScreenCollapsed(true);
  try {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
      throw Object.assign(new Error("Camera access is unavailable here"), { name: "NotSupportedError" });
    }
    await loadCameraFx();
    window.TongpingCameraFx.setLook(cameraLook);
    await window.TongpingCameraFx.open({
      video: $("cameraVideo"),
      canvas: $("cameraCanvas"),
      onStatus: (status) => { $("cameraNote").textContent = status || CAMERA_NOTE; }
    });
    cameraOn = true;
    cameraOpenedAt = Date.now();
    cameraLastLookAt = "";
    void uploadCameraFrame();
    cameraUploadTimer = setInterval(() => { void uploadCameraFrame(); }, CAMERA_UPLOAD_MS);
    postCameraNotice("📷 I turned on my camera; look whenever you want");
    if (!chatMuted.has(normalizeIdentity(state.identity))) {
      void app.updateModelContext({
        content: [{
          type: "text",
          text:
            "TongPing context: " + userAiName() + " turned on their camera (“Let Them See You”). Whenever you want to see them, call browser_camera_look with identity=" +
            state.identity + "; they see a note each time you look."
        }]
      }).catch(() => {});
    }
  } catch (error) {
    cameraBusy = false;
    closeCamera(false);
    setError(cameraErrorMessage(error));
  } finally {
    cameraBusy = false;
    renderCameraToggle();
  }
}

function closeCamera(notify = true) {
  const wasOn = cameraOn;
  cameraOn = false;
  if (cameraUploadTimer) {
    clearInterval(cameraUploadTimer);
    cameraUploadTimer = null;
  }
  try { if (window.TongpingCameraFx) window.TongpingCameraFx.close(); } catch {}
  renderCameraToggle();
  if (wasOn) {
    void call("browser_app_camera_frame", actorArgs({ active: false })).catch(() => {});
    if (notify) postCameraNotice("📷 Camera off");
  }
}

// ----- Hold-to-talk: voice note → transcript in the input, never auto-sent -----
const VOICE_NOTE_MAX_MS = 60000;
const VOICE_NOTE_MIN_MS = 500;
const VOICE_CANCEL_SWIPE_PX = 60;
let voiceMode = false;
let voicePressed = false;
let voiceCancelling = false;
let voiceBusy = false;
let voiceStream = null;
let voiceRecorder = null;
let voiceChunks = [];
let voiceStartY = 0;
let voiceStartedAt = 0;
let voiceMaxTimer = null;

function setVoiceMode(on) {
  voiceMode = on === true;
  $("talk").classList.toggle("voice", voiceMode);
  $("voiceToggle").setAttribute("aria-label", voiceMode ? "Switch to keyboard input" : "Switch to hold-to-talk");
  $("voiceToggle").title = voiceMode ? "Keyboard input" : "Hold to talk";
}

function setHoldLabel(text, cls) {
  const button = $("holdToTalk");
  button.textContent = text;
  button.classList.toggle("recording", cls === "recording");
  button.classList.toggle("cancelling", cls === "cancelling");
  button.classList.toggle("busy", cls === "busy");
}

// Failures must show on the button itself: the error line is often off
// screen, and a silent button reads as "nothing happened".
let voiceFlashTimer = null;
function flashVoiceError(short, detail) {
  if (voiceFlashTimer) clearTimeout(voiceFlashTimer);
  setHoldLabel(short, "cancelling");
  setError(detail);
  voiceFlashTimer = setTimeout(() => {
    voiceFlashTimer = null;
    if (!voicePressed && !voiceBusy) setHoldLabel("Hold to talk", "");
  }, 3200);
}

function pickVoiceMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
  for (const type of candidates) {
    try { if (MediaRecorder.isTypeSupported(type)) return type; } catch {}
  }
  return "";
}

function releaseVoiceStream() {
  if (voiceMaxTimer) {
    clearTimeout(voiceMaxTimer);
    voiceMaxTimer = null;
  }
  const stream = voiceStream;
  voiceStream = null;
  if (stream) {
    for (const track of stream.getTracks()) {
      try { track.stop(); } catch {}
    }
    restoreAudioSessionAfterRecording();
  }
}

const VOICE_DICTATION_TIP = "You can switch back to the keyboard and use its 🎤 dictation button.";
function voiceErrorShort(error) {
  const name = error && error.name ? String(error.name) : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Microphone access is unavailable here";
  if (name === "NotFoundError") return "No microphone found";
  return "Recording failed";
}
function voiceErrorMessage(error) {
  const name = error && error.name ? String(error.name) : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Microphone blocked: this app does not allow microphone access or permission has not been granted." + VOICE_DICTATION_TIP;
  }
  if (name === "NotFoundError") return "No microphone found";
  return "Recording failed: " + (error && error.message ? error.message : String(error || ""));
}

async function startVoiceNote(event) {
  if (voiceBusy || voicePressed) return;
  event.preventDefault();
  voicePressed = true;
  voiceCancelling = false;
  voiceStartY = event.clientY;
  try { $("holdToTalk").setPointerCapture(event.pointerId); } catch {}

  if (
    !navigator.mediaDevices ||
    typeof navigator.mediaDevices.getUserMedia !== "function" ||
    typeof MediaRecorder === "undefined"
  ) {
    voicePressed = false;
    flashVoiceError("Microphone is unavailable here", "Cards in this app cannot use the microphone." + VOICE_DICTATION_TIP);
    return;
  }

  setHoldLabel("Preparing…", "recording");
  claimRecordingAudioSession();
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
  } catch (error) {
    voicePressed = false;
    restoreAudioSessionAfterRecording();
    flashVoiceError(voiceErrorShort(error), voiceErrorMessage(error));
    return;
  }
  // The permission prompt swallowed the press: keep it simple, ask again.
  if (!voicePressed) {
    for (const track of stream.getTracks()) {
      try { track.stop(); } catch {}
    }
    restoreAudioSessionAfterRecording();
    setHoldLabel("Hold to talk", "");
    setNudgeStatus("Microphone is ready. Hold to talk again.");
    return;
  }

  voiceStream = stream;
  voiceChunks = [];
  const mimeType = pickVoiceMimeType();
  try {
    voiceRecorder = new MediaRecorder(
      stream,
      mimeType ? { mimeType, audioBitsPerSecond: 32000 } : { audioBitsPerSecond: 32000 }
    );
  } catch (error) {
    voicePressed = false;
    releaseVoiceStream();
    flashVoiceError(voiceErrorShort(error), voiceErrorMessage(error));
    return;
  }
  voiceRecorder.addEventListener("dataavailable", (e) => {
    if (e.data && e.data.size > 0) voiceChunks.push(e.data);
  });
  voiceRecorder.start();
  voiceStartedAt = Date.now();
  setError("");
  setHoldLabel("Release to finish · Swipe up to cancel", "recording");
  voiceMaxTimer = setTimeout(() => { void finishVoiceNote(false); }, VOICE_NOTE_MAX_MS);
}

function moveVoiceNote(event) {
  if (!voicePressed || !voiceRecorder) return;
  const cancelling = voiceStartY - event.clientY > VOICE_CANCEL_SWIPE_PX;
  if (cancelling === voiceCancelling) return;
  voiceCancelling = cancelling;
  setHoldLabel(cancelling ? "Release to cancel" : "Release to finish · Swipe up to cancel", cancelling ? "cancelling" : "recording");
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result || "");
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error || new Error("Could not read recording"));
    reader.readAsDataURL(blob);
  });
}

async function finishVoiceNote(cancel) {
  if (!voicePressed) return;
  voicePressed = false;
  const recorder = voiceRecorder;
  voiceRecorder = null;
  if (!recorder) {
    setHoldLabel("Hold to talk", "");
    return;
  }
  const duration = Date.now() - voiceStartedAt;
  const stopped = new Promise((resolve) => recorder.addEventListener("stop", resolve, { once: true }));
  try { recorder.stop(); } catch {}
  await stopped;
  releaseVoiceStream();

  if (cancel || voiceCancelling) {
    setHoldLabel("Hold to talk", "");
    setNudgeStatus("Canceled");
    return;
  }
  if (duration < VOICE_NOTE_MIN_MS) {
    setHoldLabel("Hold to talk", "");
    setNudgeStatus("Recording was too short");
    return;
  }

  const blob = new Blob(voiceChunks, { type: recorder.mimeType || voiceChunks[0]?.type || "audio/mp4" });
  voiceChunks = [];
  voiceBusy = true;
  setHoldLabel("Transcribing…", "busy");
  try {
    const audioBase64 = await blobToBase64(blob);
    const result = await call(
      "browser_app_voice_transcribe",
      actorArgs({ audioBase64, mimeType: blob.type || "audio/mp4" })
    );
    const text = result && typeof result.text === "string" ? result.text.trim() : "";
    if (!text) {
      setNudgeStatus("Could not understand. Try again.");
      return;
    }
    // Only a clear emotion earns a tag; they can delete it like any typo.
    const tag = result.emotion ? "(" + (result.emoji || "") + result.emotion + ")" : "";
    const input = $("talkText");
    const existing = input.value.trim();
    input.value = (existing ? existing + " " : "") + tag + text;
    setVoiceMode(false);
    setNudgeStatus("Transcribed. Edit it before sending.");
  } catch (error) {
    voiceBusy = false;
    flashVoiceError("Transcription failed", error && error.message ? error.message : String(error));
  } finally {
    voiceBusy = false;
    if (!voiceFlashTimer) setHoldLabel("Hold to talk", "");
  }
}

async function sendToAi() {
  const input = $("talkText");
  const text = input.value.trim();
  if (!text) return;

  const clientId =
    "user-" +
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 9);

  appendChatMessage({
    id: clientId,
    role: "user",
    text,
    createdAt: new Date().toISOString()
  });

  input.value = "";
  void postChatUser(text, clientId);

  // The user muted the AI hosting this card: the message stays in the group
  // chat (other AIs can read it) but is not sent to this AI.
  if (chatMuted.has(normalizeIdentity(state.identity))) {
    renderChat(true);
    return;
  }

  chatPending = true;
  chatPendingSince = Date.now();
  renderChat(true);

  try {
    await app.updateModelContext({
      content: [{
        type: "text",
        text:
          "TongPing context: identity=" +
          state.identity +
          ", profile=" +
          state.profile +
          ", url=" +
          (state.url || "(none)") +
          ", control=" +
          (state.takeover ? "human" : "model") +
          chatRelayInstruction() +
          groupChatDigest()
      }]
    });

    const result = await app.sendMessage({
      role: "user",
      content: [{ type: "text", text }]
    });

    if (result && result.isError) {
      throw new Error("The host refused to send the message");
    }
  } catch (error) {
    chatPending = false;
    chatPendingSince = 0;
    renderChat(true);
    setError(
      error && error.message
        ? error.message
        : error
    );
  }
}

function clearCompanionBufferingCheck() {
  if (!companionBufferingCheckTimer) return;
  clearTimeout(companionBufferingCheckTimer);
  companionBufferingCheckTimer = null;
}

function noteCompanionPlaybackProgress() {
  if (!companionModeActive) return;
  const video = $("mediaVideo");
  const now = Date.now();
  const current = Number(video.currentTime);
  if (
    Number.isFinite(current) &&
    (
      current > companionLastProgressTime + 0.03 ||
      companionLastProgressAt === 0
    )
  ) {
    companionLastProgressTime = current;
    companionLastProgressAt = now;
  }

  if (
    companionVideoStarted &&
    !video.paused &&
    !video.ended &&
    companionPhase === "buffering" &&
    now - companionLastProgressAt < 900
  ) {
    companionPhase = "playing";
    $("companionPrep").classList.remove("on");
    render();
  }
  renderCompanionTimeline();
}

function scheduleCompanionBufferingCheck(reason) {
  if (!companionModeActive || !companionVideoStarted || companionUserPaused) return;
  clearCompanionBufferingCheck();
  const video = $("mediaVideo");
  const startTime = Number(video.currentTime);
  const startedAt = Date.now();
  companionBufferingCheckTimer = setTimeout(() => {
    companionBufferingCheckTimer = null;
    if (!companionModeActive || !companionVideoStarted) return;

    const currentTime = Number(video.currentTime);
    const advanced =
      Number.isFinite(startTime) &&
      Number.isFinite(currentTime) &&
      currentTime > startTime + 0.08;
    const recentlyAdvanced =
      companionLastProgressAt > 0 &&
      Date.now() - companionLastProgressAt < 900;

    if (
      advanced ||
      recentlyAdvanced ||
      (!video.paused && video.readyState >= 3 && Date.now() - startedAt < 1800)
    ) {
      companionPhase = "playing";
      $("companionPrep").classList.remove("on");
      render();
      return;
    }

    companionPhase = "buffering";
    sendCompanionPlaybackStatus();
    updateCompanionPreparingUi();
    render();
  }, 1100);
}

for (const eventName of ["pointerdown", "touchstart", "click"]) {
  $("mediaVideo").addEventListener(eventName, () => {
    if (!companionModeActive) return;
    companionLastUserMediaInteractionAt = Date.now();
  }, { passive: true });
}

$("mediaVideo").addEventListener("pause", () => {
  if (!companionModeActive || companionUserPaused) return;
  const video = $("mediaVideo");
  if (
    video.ended ||
    companionSeekPending ||
    companionPhase === "preparing"
  ) {
    return;
  }

  const userPausedRecently =
    Date.now() - companionLastUserMediaInteractionAt < 1800;
  if (userPausedRecently) {
    companionPhase = "ready";
    sendCompanionPlaybackStatus();
    render();
    return;
  }

  if (video.readyState < 3) return;
  if (companionAutoResumeTimer) clearTimeout(companionAutoResumeTimer);
  companionAutoResumeTimer = setTimeout(() => {
    companionAutoResumeTimer = null;
    if (
      !companionModeActive ||
      companionSeekPending ||
      video.ended ||
      !video.paused ||
      video.readyState < 3 ||
      Date.now() - companionLastUserMediaInteractionAt < 1800
    ) {
      return;
    }
    void video.play().then(() => {
      companionVideoStarted = !video.paused && !video.ended;
      companionPlaybackArmed = companionVideoStarted;
      if (companionVideoStarted) {
        companionPhase = "playing";
        noteCompanionPlaybackProgress();
        sendCompanionPlaybackStatus();
        $("companionPrep").classList.remove("on");
        render();
      }
    }).catch(() => {
      companionPhase = "ready";
      sendCompanionPlaybackStatus();
      updateCompanionPreparingUi();
      render();
    });
  }, 300);
});

$("mediaVideo").addEventListener("playing", () => {
  if (!companionModeActive) return;
  clearCompanionBufferingCheck();
  companionVideoStarted = true;
  companionPlaybackArmed = true;
  companionPhase = "playing";
  noteCompanionPlaybackProgress();
  sendCompanionPlaybackStatus();
  $("companionPrep").classList.remove("on");
  $("companionProgressBar").style.width = "100%";
  setNudgeStatus(
    "Watch Together · Synchronized audio/video · About " +
    companionDelaySeconds +
    " sec"
  );
  render();
});
$("mediaVideo").addEventListener("timeupdate", () => {
  noteCompanionPlaybackProgress();
});
$("mediaVideo").addEventListener("progress", () => {
  noteCompanionPlaybackProgress();
});
$("mediaVideo").addEventListener("waiting", () => {
  scheduleCompanionBufferingCheck("waiting");
});
$("mediaVideo").addEventListener("stalled", () => {
  scheduleCompanionBufferingCheck("stalled");
});
$("mediaVideo").addEventListener("canplay", () => {
  if (!companionModeActive || !companionVideoStarted || companionUserPaused) return;
  noteCompanionPlaybackProgress();
  if (companionPhase === "buffering") {
    void $("mediaVideo").play().catch(() => {
      companionPhase = "ready";
      updateCompanionPreparingUi();
      render();
    });
  }
});
$("mediaVideo").addEventListener("error", () => {
  if (!companionModeActive) return;
  companionVideoStarted = false;
  companionPlaybackArmed = false;
  companionPhase = "preparing";
  clearCompanionBufferingCheck();
  // Preserve the original _playwait URL after a media error. The playlist
  // probe reloads this same source once it has playable segments.
  updateCompanionPreparingUi();
  render();
  scheduleCompanionProbe(1200);
});

$("frame").addEventListener("load", () => {
  if ($("frame").dataset.mode === "live") liveImageErrors = 0;
  updateRemoteCursorOverlay();
});
$("frame").addEventListener("error", () => {
  if ($("frame").dataset.mode !== "live") return;
  liveImageErrors += 1;
  if (liveImageErrors < 3) return;
  liveFailed = true;
  closeLiveSocket(false);
  $("frame").removeAttribute("data-mode");
  refreshImage();
});
$("open").addEventListener("click", navigate);
$("address").addEventListener("keydown", (event) => { if (event.key === "Enter") void navigate(); });
$("back").addEventListener("click", () => { void historyNavigate("back"); });
$("forward").addEventListener("click", () => { void historyNavigate("forward"); });
$("refresh").addEventListener("click", () => { void reloadPage(); });
$("takeover").addEventListener("click", toggleTakeover);
$("localLogin").addEventListener("click", () => { void toggleLocalLogin(); });
$("watchTicket").addEventListener("click", () => {
  void generateWatchTicket();
});
$("ticketClose").addEventListener("click", () => {
  closeTicketOverlay();
});
$("ticketOverlay").addEventListener("click", (event) => {
  if (event.target === $("ticketOverlay")) {
    closeTicketOverlay();
  }
});
$("collectionSwitch").addEventListener("click", () => {
  if (watchCollectionEnabled) {
    void disableWatchCollection().catch((error) => {
      setError(
        error && error.message
          ? error.message
          : error
      );
    });
    return;
  }
  showTicketPrivacy();
});
$("collectionConsent").addEventListener("click", () => {
  void enableWatchCollection().catch((error) => {
    setError(
      error && error.message
        ? error.message
        : error
    );
  });
});
$("collectionConsentCancel").addEventListener("click", () => {
  hideTicketPrivacy();
});
$("ticketDownload").addEventListener("click", () => { void downloadCurrentTicket(); });
$("chatClear").addEventListener("click", () => { void onChatClearClick(); });
$("ticketReframe").addEventListener("click", () => { void generateWatchTicket(); });
$("ticketOpenLibrary").addEventListener("click", () => {
  void openWatchLibrary();
});
$("ticketLibraryBack").addEventListener("click", () => {
  closeWatchLibrary();
});
$("ticketLibraryClear").addEventListener("click", () => {
  const button = $("ticketLibraryClear");
  const now = Date.now();

  if (now > ticketClearConfirmUntil) {
    ticketClearConfirmUntil = now + 3500;
    button.textContent = "Select again to confirm";
    setTimeout(() => {
      if (Date.now() > ticketClearConfirmUntil) {
        button.textContent = "Clear";
      }
    }, 3700);
    return;
  }

  ticketClearConfirmUntil = 0;
  button.textContent = "Clear";
  if (!watchCollectionId) return;

  void watchCollectionRequest("clear")
    .then(() => {
      renderWatchLibrary();
      setTicketToast("Watch Collection cleared");
    })
    .catch((error) => {
      setError(
        error && error.message
          ? error.message
          : error
      );
    });
});
$("ticketLibraryList").addEventListener("click", (event) => {
  const button =
    event.target instanceof Element
      ? event.target.closest("button[data-ticket-id]")
      : null;
  if (!(button instanceof HTMLButtonElement)) return;

  const ticketId = button.dataset.ticketId || "";
  if (!ticketId || !watchCollectionId) return;

  button.disabled = true;
  void watchCollectionRequest(
    "delete",
    { ticketId }
  )
    .then(() => {
      renderWatchLibrary();
      setTicketToast("Ticket deleted");
    })
    .catch((error) => {
      button.disabled = false;
      setError(
        error && error.message
          ? error.message
          : error
      );
    });
});

$("showToAi").addEventListener("click", () => {
  void showCurrentFrameToAi();
});
$("cameraShare").addEventListener("click", async () => {
  const button = $("cameraShare");
  button.classList.add("working");
  try { await showCurrentFrameToAi(); } finally { button.classList.remove("working"); }
});
$("companionSeek").addEventListener("input", () => {
  companionSeekDragging = true;
  renderCompanionTimeline();
});
$("companionSeek").addEventListener("change", () => {
  const target = Number($("companionSeek").value);
  companionSeekDragging = false;
  void seekCompanionToSource(target);
});
$("companionSeek").addEventListener("pointerup", () => {
  companionSeekDragging = false;
});

// ----- v89 chrome: skins, menu, remote drawer, bookmarks -----
const APP_SKINS = [
  ["candy", "Candy Frosting"],
  ["mist", "Misty Pink"],
  ["sage", "Sage Gray"],
  ["dusk", "Misty Night"],
  ["night", "Night Gold"],
  ["claude", "Claude Orange"],
  ["mint", "Night Mint"]
];
// When this card was opened: the server lets only the newest card hold
// live/media sockets (tickets renew, so their expiry cannot rank cards).
var CARD_BORN_AT = CARD_BORN_AT || Date.now();
function withCardStamp(url) {
  const value = String(url || "");
  if (!value) return value;
  // Sockets can open before this block runs (the var is hoisted, unset).
  if (!CARD_BORN_AT) CARD_BORN_AT = Date.now();
  return value + (value.indexOf("?") >= 0 ? "&" : "?") + "card=" + CARD_BORN_AT;
}
var currentSkin = "candy";
const SKIN_SWATCHES = {
  candy: "linear-gradient(135deg,#f2c3d2,#d8ccf1)",
  mist: "linear-gradient(135deg,#d6aea9,#b9c3ae)",
  sage: "linear-gradient(135deg,#a8b8a4,#9fb1bd)",
  dusk: "linear-gradient(135deg,#6b5561,#d8b0ab)",
  night: "linear-gradient(135deg,#0e0f13,#c9a96e)",
  claude: "linear-gradient(135deg,#f6dfc8,#d97757)",
  mint: "linear-gradient(135deg,#111314 55%,#8fd3b8)"
};
var remoteDrawerOpen = false;
var lastRenderedTakeover = false;
var skinToastTimer = null;

function readPref(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writePref(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}

function applySkin(id, announce) {
  const known = APP_SKINS.find((item) => item[0] === id);
  const skin = known ? known[0] : "candy";
  currentSkin = skin;
  document.documentElement.setAttribute("data-skin", skin);
  writePref("tongping-skin", skin);
  const box = $("menuSkins");
  if (box) {
    box.textContent = "";
    for (const item of APP_SKINS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "skinDot" + (item[0] === skin ? " on" : "");
      const swatch = document.createElement("i");
      swatch.style.background = SKIN_SWATCHES[item[0]] || "";
      const name = document.createElement("span");
      name.textContent = item[1];
      button.append(swatch, name);
      button.addEventListener("click", () => applySkin(item[0], true));
      box.appendChild(button);
    }
  }
  if (announce) {
    const toast = $("skinToast");
    const name = (known || APP_SKINS[0])[1];
    toast.textContent = "Theme · " + name;
    toast.classList.add("on");
    if (skinToastTimer) clearTimeout(skinToastTimer);
    skinToastTimer = setTimeout(() => toast.classList.remove("on"), 1400);
  }
}

// v90: fold the screen away to just chat; nothing streams while folded.
var screenCollapsed = false;
function applyScreenCollapsed(collapsed) {
  screenCollapsed = Boolean(collapsed);
  $("shell").classList.toggle("screenCollapsed", screenCollapsed);
  if (nowPlayingTimer) {
    clearInterval(nowPlayingTimer);
    nowPlayingTimer = null;
  }
  if (screenCollapsed) {
    renderNowPlaying();
    nowPlayingTimer = setInterval(renderNowPlaying, 1000);
  }
  const button = $("screenToggle");
  button.classList.toggle("on", screenCollapsed);
  button.setAttribute("aria-pressed", String(screenCollapsed));
  button.title = screenCollapsed ? "Expand view" : "Collapse view; chat only (playback continues)";
  button.setAttribute("aria-label", screenCollapsed ? "Expand view" : "Collapse view");
  $("screenToggleLabel").textContent = screenCollapsed ? "Show view" : "Chat only";
}
function setScreenCollapsed(collapsed) {
  applyScreenCollapsed(collapsed);
  writePref("tongping-screen-collapsed", screenCollapsed ? "1" : "0");
  // Folding only hides the screen: live, companion playback, its clock and
  // buffer keep going so expanding lands right back in the scene.
  if (!screenCollapsed) {
    requestAnimationFrame(() => {
      refreshImage();
      scheduleLiveFrameResync();
    });
  }
}

var nowPlayingTimer = null;
function renderNowPlaying() {
  if (!screenCollapsed) return;
  const title = cleanTicketTitle(state.title) || state.title || "Current page";
  $("npTitle").textContent = title;
  if (companionModeActive) {
    const video = $("mediaVideo");
    const pts = currentCompanionSourcePts(video);
    setNowPlayingIcon(companionUserPaused || video.paused ? "pause" : "play");
    $("npTime").textContent =
      formatCompanionTime(pts) +
      (companionSourceDuration !== null ? " / " + formatCompanionTime(companionSourceDuration) : "");
  } else {
    setNowPlayingIcon("live");
    $("npTime").textContent = "Live view";
  }
}

// Same line-drawn glyphs as the dock buttons, never system emoji.
const NOW_PLAYING_ICONS = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="fill" d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg>',
  live: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="fill" cx="12" cy="12" r="4.5"/></svg>'
};
function setNowPlayingIcon(kind) {
  const icon = $("npIcon");
  if (icon.dataset.icon === kind) return;
  icon.dataset.icon = kind;
  icon.innerHTML = NOW_PLAYING_ICONS[kind] || NOW_PLAYING_ICONS.live;
}

function setRemoteDrawer(open) {
  remoteDrawerOpen = Boolean(open);
  $("remoteDrawer").classList.toggle("open", remoteDrawerOpen);
  $("drawerToggle").setAttribute("aria-expanded", String(remoteDrawerOpen));
  writePref("tongping-remote-drawer", remoteDrawerOpen ? "1" : "0");
}

function setMenuOpen(open) {
  $("menuSheet").hidden = !open;
  $("menuToggle").setAttribute("aria-expanded", String(Boolean(open)));
}

const BOOKMARK_NAMES = [
  ["douyin.com", "Douyin"],
  ["bilibili.com", "Bilibili"],
  ["xiaohongshu.com", "Xiaohongshu"],
  ["youtube.com", "YouTube"],
  ["iqiyi.com", "iQIYI"],
  ["v.qq.com", "Tencent Video"],
  ["youku.com", "Youku"]
];
function bookmarkLabel(url) {
  let host = "";
  try { host = new URL(url).hostname; } catch { return String(url).slice(0, 24); }
  if (host.startsWith("www.")) host = host.slice(4);
  const known = BOOKMARK_NAMES.find((item) => host === item[0] || host.endsWith("." + item[0]));
  let label = known ? known[1] : host;
  try {
    const path = new URL(url).pathname;
    if (known && path && path !== "/") label += " · " + path.split("/").filter(Boolean)[0];
  } catch {}
  return label;
}
function loadBookmarks() {
  try {
    const raw = JSON.parse(readPref("tongping-bookmarks") || "null");
    if (Array.isArray(raw)) {
      return raw
        .filter((item) => item && typeof item.url === "string" && /^https?:/.test(item.url))
        .slice(0, 24);
    }
  } catch {}
  return [
    { url: "https://www.douyin.com/jingxuan", title: "Douyin · Picks" },
    { url: "https://www.bilibili.com/", title: "Bilibili" }
  ];
}
var bookmarks = loadBookmarks();
function currentBookmarkUrl() {
  const value = String(state.url || $("address").value || "").trim();
  return /^https?:/.test(value) ? value : "";
}
function renderBookmarks() {
  const box = $("bookmarks");
  box.textContent = "";
  for (const item of bookmarks) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "bookmarkChip";
    chip.title = item.url;
    const label = document.createElement("span");
    label.textContent = item.title || bookmarkLabel(item.url);
    const remove = document.createElement("b");
    remove.textContent = "×";
    remove.setAttribute("aria-label", "Remove bookmark");
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      bookmarks = bookmarks.filter((entry) => entry.url !== item.url);
      writePref("tongping-bookmarks", JSON.stringify(bookmarks));
      renderBookmarks();
    });
    chip.append(label, remove);
    chip.addEventListener("click", () => {
      $("address").value = item.url;
      $("open").click();
    });
    box.appendChild(chip);
  }
  const url = currentBookmarkUrl();
  $("bookmarkAdd").classList.toggle("on", Boolean(url) && bookmarks.some((entry) => entry.url === url));
}
function toggleCurrentBookmark() {
  const url = currentBookmarkUrl();
  if (!url) {
    setNudgeStatus("Open a webpage before bookmarking");
    return;
  }
  if (bookmarks.some((entry) => entry.url === url)) {
    bookmarks = bookmarks.filter((entry) => entry.url !== url);
  } else {
    bookmarks = [{ url, title: bookmarkLabel(url) }].concat(bookmarks).slice(0, 24);
  }
  writePref("tongping-bookmarks", JSON.stringify(bookmarks));
  renderBookmarks();
}

function renderChromeExtras() {
  // render() can run before this block has initialised (hoisted call).
  if (!Array.isArray(bookmarks) || !$("remoteDrawer")) return;
  const takeover = Boolean(state.takeover);
  if (takeover && !lastRenderedTakeover && !remoteDrawerOpen) setRemoteDrawer(true);
  lastRenderedTakeover = takeover;
  if ($("bookmarks")) {
    const url = currentBookmarkUrl();
    $("bookmarkAdd").classList.toggle("on", Boolean(url) && bookmarks.some((entry) => entry.url === url));
  }
}

applySkin(readPref("tongping-skin") || "candy", false);
applyScreenCollapsed(readPref("tongping-screen-collapsed") === "1");
$("screenToggle").addEventListener("click", () => setScreenCollapsed(!screenCollapsed));
$("npExpand").addEventListener("click", () => setScreenCollapsed(false));
setRemoteDrawer(readPref("tongping-remote-drawer") === "1");
renderBookmarks();
$("skinToggle").addEventListener("click", () => {
  const index = APP_SKINS.findIndex((item) => item[0] === currentSkin);
  applySkin(APP_SKINS[(index + 1) % APP_SKINS.length][0], true);
});
$("menuToggle").addEventListener("click", (event) => {
  event.stopPropagation();
  setMenuOpen($("menuSheet").hidden);
});
document.addEventListener("click", (event) => {
  const sheet = $("menuSheet");
  if (!sheet.hidden && !sheet.contains(event.target) && event.target !== $("menuToggle")) {
    setMenuOpen(false);
  }
});
$("drawerToggle").addEventListener("click", () => setRemoteDrawer(!remoteDrawerOpen));

// Live sound is on by default, but a page may only start audio from a tap:
// the first tap anywhere turns it on unless the viewer switched it off.
function armDefaultLiveSound(event) {
  if (readPref("tongping-live-sound") === "0") {
    document.removeEventListener("pointerdown", armDefaultLiveSound, true);
    return;
  }
  if (event && event.target && $("sound").contains(event.target)) return;
  if (audioEnabled || companionModeActive || !state.audioUrl || !connected) return;
  document.removeEventListener("pointerdown", armDefaultLiveSound, true);
  void toggleAudio();
}
document.addEventListener("pointerdown", armDefaultLiveSound, true);
$("bookmarkAdd").addEventListener("click", () => toggleCurrentBookmark());

$("companion").addEventListener("click", () => { void toggleCompanionMode(); });
$("companionPause").addEventListener("click", () => { toggleCompanionUserPause(); });
$("pausedOverlay").addEventListener("click", () => {
  if (companionUserPaused) toggleCompanionUserPause();
});
$("companionCancel").addEventListener("click", () => {
  if (companionModeActive) {
    stopCompanionPlayback(true);
    setNudgeStatus("Back to LIVE");
  }
});
$("companionStart").addEventListener("click", () => {
  void startPreparedCompanionPlayback();
});
$("sound").addEventListener("click", () => { void toggleAudio(); });
$("typeText").addEventListener("click", sendHumanText);
$("humanText").addEventListener("keydown", (event) => { if (event.key === "Enter") void sendHumanText(); });
$("enter").addEventListener("click", () => key("Enter"));
$("esc").addEventListener("click", () => key("Escape"));
$("talkSend").addEventListener("click", sendToAi);
$("voiceToggle").addEventListener("click", () => setVoiceMode(!voiceMode));
cameraLook = readPref("tongping-camera-look") || "soft";
$("cameraToggle").addEventListener("click", () => {
  if (cameraOn) closeCamera(true);
  else void openCamera();
});
$("cameraClose").addEventListener("click", () => closeCamera(true));
$("cameraFlip").addEventListener("click", () => {
  if (cameraOn && window.TongpingCameraFx) {
    void window.TongpingCameraFx.flip().catch((error) => setError(cameraErrorMessage(error)));
  }
});
window.addEventListener("pagehide", () => closeCamera(false));
$("holdToTalk").addEventListener("pointerdown", (event) => { void startVoiceNote(event); });
$("holdToTalk").addEventListener("pointermove", moveVoiceNote);
$("holdToTalk").addEventListener("pointerup", () => { void finishVoiceNote(false); });
$("holdToTalk").addEventListener("pointercancel", () => { void finishVoiceNote(true); });
$("holdToTalk").addEventListener("contextmenu", (event) => event.preventDefault());
$("talkText").addEventListener("keydown", (event) => { if (event.key === "Enter") void sendToAi(); });
document.addEventListener("visibilitychange", () => {
  if (
    document.visibilityState === "visible" &&
    audioEnabled &&
    audioContext &&
    audioContext.state === "suspended"
  ) {
    void audioContext.resume().catch(() => {});
  }
});
$("identity").addEventListener("change", () => {
  state.identity = normalizeIdentity($("identity").value);
  void refreshFrame();
});
$("profile").addEventListener("change", () => {
  if (companionModeActive) stopCompanionPlayback(false);
  resetChatLane();
  state.profile = normalizeProfile($("profile").value);
  state.chatUrl = "";
  state.watchCollectionUrl = "";
  state.watchCollectionWriteUrl = "";
  currentWatchTicket = null;
  renderCurrentWatchTicket();
  closeMediaSocket(true, true);
  closeLiveSocket();
  state.frameUrl = "";
  state.liveUrl = "";
  state.mediaUrl = "";
  closeAudioSocket(true);
  state.audioUrl = "";
  state.inputUrl = "";
  state.controlUrl = "";
  state.base64 = "";
  liveFailed = false;
  liveSuperseded = false;
  liveRetryCount = 0;
  liveImageErrors = 0;
  $("frame").removeAttribute("data-mode");
  remoteCursor = null;
  remoteHeld = false;
  trackGesture = null;
  leftPointerId = null;
  rightPointerId = null;
  lastPadTapAt = 0;
  lastPadTapPoint = null;
  moveCommandInFlight = false;
  pendingRemoteMove = null;
  hideContextMirror();
  render();
  void refreshFrame();
});
function activeViewportElement() {
  // Buffered media is never coordinate authority. Controls only read the
  // realtime surface after takeover/navigation has switched lanes.
  return $("liveCanvas").style.display !== "none"
    ? $("liveCanvas")
    : $("frame");
}

function logicalPoint(clientX, clientY) {
  const frame = activeViewportElement();
  const rect = frame.getBoundingClientRect();
  const logicalWidth = Number(
    state.viewport.width || frame.naturalWidth || 0
  );
  const logicalHeight = Number(
    state.viewport.height || frame.naturalHeight || 0
  );
  if (!logicalWidth || !logicalHeight || !rect.width || !rect.height) {
    return null;
  }
  return {
    x: Math.max(
      0,
      Math.min(
        logicalWidth,
        (clientX - rect.left) * logicalWidth / rect.width
      )
    ),
    y: Math.max(
      0,
      Math.min(
        logicalHeight,
        (clientY - rect.top) * logicalHeight / rect.height
      )
    )
  };
}

function showPointer(event) {
  const wrap = $("viewportWrap").getBoundingClientRect();
  $("pointerDot").style.left = (event.clientX - wrap.left) + "px";
  $("pointerDot").style.top = (event.clientY - wrap.top) + "px";
  $("pointerDot").classList.add("on");
}

function hidePointer() {
  $("pointerDot").classList.remove("on");
}

async function postPointer(phase, point, options = {}) {
  await sendLiveCommand({
    type: "pointer",
    phase,
    x: point.x,
    y: point.y,
    button: options.button === "right" ? "right" : "left",
    clickCount: options.clickCount === 2 ? 2 : 1
  }, 9000);
}

async function clickRemote(button = "left", clickCount = 1) {
  const cursor = ensureRemoteCursor();
  const options = {
    button: button === "right" ? "right" : "left",
    clickCount: clickCount === 2 ? 2 : 1
  };

  // Keep taps on the realtime websocket. Send DOWN immediately, keep a short
  // real press interval locally, then send UP without waiting for the DOWN
  // round-trip. The worker serializes pointer commands in order.
  setNudgeStatus(
    (clickCount === 2 ? "Double-click" : button === "right" ? "Right" : "Click") +
    " · Sending…"
  );
  const down = postPointer("down", cursor, options);
  await new Promise((resolve) => setTimeout(resolve, 36));
  const up = postPointer("up", cursor, options);
  await Promise.all([down, up]);
  setNudgeStatus(
    (clickCount === 2 ? "Double-click" : button === "right" ? "Right" : "Click") +
    " · Sent · x=" + Math.round(cursor.x) +
    " y=" + Math.round(cursor.y)
  );
}

// The person this card belongs to. The personal server names her; on the
// shared pilot server nobody's name is baked into the card.
function userShownName() { return state.userName || "Me"; }
function userAiName() { return state.userName || "the user"; }
function userZhName() { return state.userName || "User"; }

function setNudgeStatus(text) {
  $("nudgeStatus").textContent = text;
}

function ensureRemoteCursor() {
  if (remoteCursor) return remoteCursor;
  const width = Number(state.viewport.width || 768);
  const height = Number(state.viewport.height || 1024);
  remoteCursor = { x: width / 2, y: height / 2 };
  return remoteCursor;
}

function updateRemoteCursorOverlay() {
  if (!remoteCursor || !state.takeover) {
    $("pointerDot").classList.remove("on");
    return;
  }
  const active = activeViewportElement();
  const frameRect = active.getBoundingClientRect();
  const wrapRect = $("viewportWrap").getBoundingClientRect();
  const width = Number(state.viewport.width || $("frame").naturalWidth || 0);
  const height = Number(state.viewport.height || $("frame").naturalHeight || 0);
  if (!width || !height || !frameRect.width || !frameRect.height) return;
  $("pointerDot").style.left =
    (frameRect.left - wrapRect.left + remoteCursor.x / width * frameRect.width) + "px";
  $("pointerDot").style.top =
    (frameRect.top - wrapRect.top + remoteCursor.y / height * frameRect.height) + "px";
  $("pointerDot").classList.add("on");
}

async function moveRemoteBy(dx, dy) {
  const cursor = ensureRemoteCursor();
  const width = Number(state.viewport.width || 768);
  const height = Number(state.viewport.height || 1024);
  remoteCursor = {
    x: Math.max(0, Math.min(width, cursor.x + dx)),
    y: Math.max(0, Math.min(height, cursor.y + dy))
  };
  updateRemoteCursorOverlay();
  pendingRemoteMove = { x: remoteCursor.x, y: remoteCursor.y };
  void pumpRemoteMove();
  setNudgeStatus(
    (remoteHeld ? "Dragging · " : "") +
    "x=" + Math.round(remoteCursor.x) +
    " y=" + Math.round(remoteCursor.y)
  );
}

async function pumpRemoteMove() {
  if (moveCommandInFlight) return;
  moveCommandInFlight = true;
  try {
    while (pendingRemoteMove) {
      const point = pendingRemoteMove;
      pendingRemoteMove = null;
      try {
        await postPointer("move", point);
      } catch (error) {
        setError(error && error.message ? error.message : error);
        // Do not replay stale intermediate moves after a timeout.
        pendingRemoteMove = null;
        break;
      }
    }
  } finally {
    moveCommandInFlight = false;
    if (pendingRemoteMove) void pumpRemoteMove();
  }
}

function noteMouseStatus(prefix = "") {
  const cursor = ensureRemoteCursor();
  setNudgeStatus(
    (prefix ? prefix + " · " : "") +
    "x=" + Math.round(cursor.x) +
    " y=" + Math.round(cursor.y)
  );
}

$("leftMouse").addEventListener("pointerdown", (event) => {
  if (!state.takeover || leftPointerId !== null) return;
  const cursor = ensureRemoteCursor();
  pendingRemoteMove = null;
  leftPointerId = event.pointerId;
  remoteHeld = true;
  $("leftMouse").classList.add("pressed");
  try { $("leftMouse").setPointerCapture(event.pointerId); } catch {}
  noteMouseStatus("Holding left button");
  void postPointer("down", cursor, { button: "left", clickCount: 1 })
    .catch((error) => {
      remoteHeld = false;
      $("leftMouse").classList.remove("pressed");
      setError(error && error.message ? error.message : error);
    });
  event.preventDefault();
});

function releaseLeftMouse(event) {
  if (leftPointerId === null || event.pointerId !== leftPointerId) return;
  const cursor = ensureRemoteCursor();
  pendingRemoteMove = null;
  try { $("leftMouse").releasePointerCapture(leftPointerId); } catch {}
  leftPointerId = null;
  remoteHeld = false;
  $("leftMouse").classList.remove("pressed");
  noteMouseStatus("Left");
  void postPointer("up", cursor, { button: "left", clickCount: 1 })
    .catch((error) => setError(error && error.message ? error.message : error));
  event.preventDefault();
}
$("leftMouse").addEventListener("pointerup", releaseLeftMouse);
$("leftMouse").addEventListener("pointercancel", releaseLeftMouse);

$("rightMouse").addEventListener("pointerdown", (event) => {
  if (!state.takeover || rightPointerId !== null) return;
  const cursor = ensureRemoteCursor();
  pendingRemoteMove = null;
  rightPointerId = event.pointerId;
  $("rightMouse").classList.add("pressed");
  try { $("rightMouse").setPointerCapture(event.pointerId); } catch {}
  noteMouseStatus("Right");
  void postPointer("down", cursor, { button: "right", clickCount: 1 })
    .catch((error) => {
      $("rightMouse").classList.remove("pressed");
      setError(error && error.message ? error.message : error);
    });
  event.preventDefault();
});

function releaseRightMouse(event) {
  if (rightPointerId === null || event.pointerId !== rightPointerId) return;
  const cursor = ensureRemoteCursor();
  try { $("rightMouse").releasePointerCapture(rightPointerId); } catch {}
  rightPointerId = null;
  $("rightMouse").classList.remove("pressed");
  void postPointer("up", cursor, { button: "right", clickCount: 1 })
    .then(() => {
      void openContextMirror(cursor);
    })
    .catch((error) => setError(error && error.message ? error.message : error));
  event.preventDefault();
}
$("rightMouse").addEventListener("pointerup", releaseRightMouse);
$("rightMouse").addEventListener("pointercancel", releaseRightMouse);

$("trackpad").addEventListener("pointerdown", (event) => {
  if (!state.takeover || trackGesture) return;
  ensureRemoteCursor();
  trackGesture = {
    id: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    x: event.clientX,
    y: event.clientY,
    startedAt: performance.now(),
    distance: 0,
    dismissMenu: contextMenuOpen
  };
  $("trackpad").classList.add("active");
  $("trackDot").style.left = (event.offsetX || 0) + "px";
  $("trackDot").style.top = (event.offsetY || 0) + "px";
  $("trackDot").classList.add("on");
  try { $("trackpad").setPointerCapture(event.pointerId); } catch {}
  event.preventDefault();
});

$("trackpad").addEventListener("pointermove", (event) => {
  if (!trackGesture || trackGesture.id !== event.pointerId) return;
  const dx = event.clientX - trackGesture.x;
  const dy = event.clientY - trackGesture.y;
  trackGesture.x = event.clientX;
  trackGesture.y = event.clientY;
  trackGesture.distance += Math.hypot(dx, dy);
  if (trackGesture.dismissMenu) {
    event.preventDefault();
    return;
  }
  $("trackDot").style.left = (event.offsetX || 0) + "px";
  $("trackDot").style.top = (event.offsetY || 0) + "px";
  const distance = Math.hypot(dx, dy);
  if (distance > 0.2) {
    const gain = Math.max(3.2, Math.min(6.0, 2.9 + distance * 0.10));
    void moveRemoteBy(dx * gain, dy * gain).catch((error) => {
      setError(error && error.message ? error.message : error);
    });
  }
  event.preventDefault();
});

function endTrackGesture(event) {
  if (!trackGesture || trackGesture.id !== event.pointerId) return;
  const gesture = trackGesture;
  trackGesture = null;
  $("trackpad").classList.remove("active");
  $("trackDot").classList.remove("on");
  try { $("trackpad").releasePointerCapture(event.pointerId); } catch {}

  const elapsed = performance.now() - gesture.startedAt;
  const netDistance = Math.hypot(
    gesture.x - gesture.startX,
    gesture.y - gesture.startY
  );
  // iOS emits tiny pointermove jitter during an otherwise stationary tap.
  // Judge a tap by net displacement instead of accumulated micro-movement.
  const isTap =
    netDistance <= 16 &&
    gesture.distance <= 32 &&
    elapsed <= 560;

  if (
    gesture.dismissMenu &&
    isTap &&
    event.type !== "pointercancel"
  ) {
    hideContextMirror();
    lastPadTapAt = 0;
    lastPadTapPoint = null;
    setNudgeStatus("Context menu closed");
    void key("Escape");
    event.preventDefault();
    return;
  }

  if (isTap && !remoteHeld && event.type !== "pointercancel") {
    const now = performance.now();
    const cursor = ensureRemoteCursor();
    const prior = lastPadTapPoint;
    const nearPrior =
      prior &&
      Math.hypot(cursor.x - prior.x, cursor.y - prior.y) <= 18;
    const isDouble = nearPrior && now - lastPadTapAt <= 340;
    lastPadTapAt = now;
    lastPadTapPoint = { x: cursor.x, y: cursor.y };
    void clickRemote("left", isDouble ? 2 : 1)
      .then(() => noteMouseStatus(isDouble ? "Double-click" : "Click"))
      .catch((error) => setError(error && error.message ? error.message : error));
    if (isDouble) {
      lastPadTapAt = 0;
      lastPadTapPoint = null;
    }
  } else {
    noteMouseStatus(remoteHeld ? "Dragging" : "Move");
  }

  event.preventDefault();
}
$("trackpad").addEventListener("pointerup", endTrackGesture);
$("trackpad").addEventListener("pointercancel", endTrackGesture);

$("contextMirror").addEventListener("click", (event) => {
  const button = event.target instanceof Element
    ? event.target.closest("button[data-context-action]")
    : null;
  if (!(button instanceof HTMLButtonElement)) return;

  const action = button.dataset.contextAction || "";
  const href =
    contextMenuTarget && typeof contextMenuTarget.href === "string"
      ? contextMenuTarget.href
      : "";

  hideContextMirror();
  lastPadTapAt = 0;
  lastPadTapPoint = null;

  if (action === "back") {
    void historyNavigate("back");
  } else if (action === "forward") {
    void historyNavigate("forward");
  } else if (action === "reload") {
    void reloadPage();
  } else if (action === "open-link" && href) {
    $("address").value = href;
    void call("browser_app_navigate", actorArgs({ url: href }))
      .then((data) => {
        applyState(data);
        startPolling();
      })
      .catch((error) => setError(error && error.message ? error.message : error));
  } else if (action === "copy-link" && href) {
    void copyText(href)
      .then(() => setNudgeStatus("Link address copied"))
      .catch((error) => setError(error && error.message ? error.message : error));
  } else {
    setNudgeStatus("Context menu closed");
  }

  event.preventDefault();
  event.stopPropagation();
});

$("fullscreen").addEventListener("click", async () => {
  try {
    const target = state.displayMode === "fullscreen" ? "inline" : "fullscreen";
    const result = await app.requestDisplayMode({ mode: target });
    state.displayMode = result.mode || target;
    try { applyHostLayout(app.getHostContext && app.getHostContext()); } catch {}
    // v90: the button lives in the menu sheet; get panels out of the way
    // so fullscreen actually shows the picture.
    setMenuOpen(false);
    if (state.displayMode === "fullscreen") setRemoteDrawer(false);
    render();
    requestAnimationFrame(() => {
      refreshImage();
      scheduleLiveFrameResync();
    });
  } catch (error) {
    setError(error && error.message ? error.message : error);
  }
});

app.ontoolresult = (result) => {
  const data = structured(result);
  if (data && data.kind === "tongping") {
    applyState(data);
    void refreshFrame();
    startPolling();
  }
};
function applyHostLayout(ctx) {
  const inset = (ctx && ctx.safeAreaInsets) || {};
  let top = Number(inset.top) || 0;
  let bottom = Number(inset.bottom) || 0;
  let isClaudeHost = false;
  if (state.displayMode === "fullscreen") {
    let hostName = "";
    try {
      const info = app.getHostVersion && app.getHostVersion();
      hostName = String((info && info.name) || "");
    } catch {}
    // Claude's fullscreen draws its close button/title over the top and its
    // composer over the bottom; keep the card clear even without insets.
    isClaudeHost = /claude|anthropic/i.test(hostName);
    if (isClaudeHost) {
      top = Math.max(top, 64);
      bottom = Math.max(bottom, 120);
    }
    // ChatGPT's fullscreen floats its composer over the bottom of the card
    // too, and does not always report it as a safe-area inset.
    const openai = window.openai;
    if (openai || /chatgpt|openai/i.test(hostName)) {
      const openaiInsets = (openai && openai.safeArea && openai.safeArea.insets) || {};
      top = Math.max(top, Number(openaiInsets.top) || 0);
      bottom = Math.max(bottom, Number(openaiInsets.bottom) || 0, 120);
    }
  } else {
    top = 0;
    bottom = 0;
  }
  $("shell").classList.toggle("hostClaude", isClaudeHost);
  const rootStyle = document.documentElement.style;
  rootStyle.setProperty("--host-top", top + "px");
  rootStyle.setProperty("--host-bottom", bottom + "px");
}

app.onhostcontextchanged = (ctx) => {
  if (ctx && ctx.displayMode) state.displayMode = ctx.displayMode;
  applyHostLayout(ctx || (app.getHostContext && app.getHostContext()));
  if (ctx && ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx && ctx.styles && ctx.styles.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx && ctx.styles && ctx.styles.css && ctx.styles.css.fonts) applyHostFonts(ctx.styles.css.fonts);
  if (ctx && ctx.displayMode) {
    state.displayMode = ctx.displayMode;
    render();
    requestAnimationFrame(() => {
      refreshImage();
      scheduleLiveFrameResync();
    });
  }
};

loadWatchCollectionLocalPrefs();
renderWatchCollectionState();
renderCurrentWatchTicket();

try {
  await app.connect();
  connected = true;
  const ctx = app.getHostContext && app.getHostContext();
  if (ctx) {
    if (ctx.theme) applyDocumentTheme(ctx.theme);
    if (ctx.styles && ctx.styles.variables) applyHostStyleVariables(ctx.styles.variables);
    if (ctx.styles && ctx.styles.css && ctx.styles.css.fonts) applyHostFonts(ctx.styles.css.fonts);
    if (ctx.displayMode) state.displayMode = ctx.displayMode;
  }
  applyHostLayout(ctx);
  render();
  startChatSync();
} catch (error) {
  setError("MCP App connection failed: " + (error && error.message ? error.message : error));
}
</script>
</body>
</html>`;
}

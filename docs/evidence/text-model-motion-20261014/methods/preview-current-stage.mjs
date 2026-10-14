import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const repo=resolve('/workspace/ChoreographyStudio');
const out=join(repo,'work/model-selection-20261014/product-preview');
const input=join(repo,'work/model-selection-20261014/text-motion-experiment');
const styles=[
 ['chinese-classical','中国古典舞','audit-chinese-classical-1791956279320'],
 ['hip-hop','街舞','audit-hip-hop-1791956376756'],
 ['ballet','芭蕾','audit-ballet-1791956376740'],
];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourcePath=join(input,'owned-source-snapshot.json');
const sourceBytes=await readFile(sourcePath);
const source=JSON.parse(sourceBytes.toString());
assert.equal(source.countMap.durationSeconds,32);
assert.equal(source.plan,null);
const inputs=[];
for(const [style,label,folder] of styles){
 const path=join(input,folder,'solver-returned-patch.json');
 const bytes=await readFile(path);
 const patch=JSON.parse(bytes.toString());
 assert.equal(patch.provider,'codex-session');
 assert.equal(patch.model,'gpt-6.1-sol');
 assert.deepEqual(patch.target,{mode:'interval',startSeconds:4,endSeconds:9.5});
 assert.equal(patch.motionOrigin,undefined);
 inputs.push({style,label,path,sha256:sha(bytes),patch});
}
// New synthetic silence is a playback carrier, not any original music.
const rate=8000,samples=32*rate,wav=Buffer.alloc(44+samples*2);
wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVE',8);wav.write('fmt ',12);wav.writeUInt32LE(16,16);
wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);
wav.write('data',36);wav.writeUInt32LE(samples*2,40);
await mkdir(out,{recursive:true});
await writeFile(join(out,'owned-review-silence-32s.wav'),wav);
const report={startedAtUTC:new Date().toISOString(),scope:'One bounded localhost viewing session in the current real App Stage; offline independently gated codex-session/gpt-6.1-sol AI tracks in separate owned review scenes. Not live generation, temporary candidate-state UX or user adoption.',source:{path:sourcePath,fileSHA256Before:sha(sourceBytes),durationSeconds:32,originalSnapshotRetained:true},syntheticPlaybackAudio:{path:'owned-review-silence-32s.wav',sha256:sha(wav),durationSeconds:32,allPCMZero:true},inputs:inputs.map(({patch,...v})=>({...v,provider:patch.provider,model:patch.model,requestId:patch.requestId,sourceHash:patch.sourceHash,knots:patch.knots.length})),network:{providerCalls:0,apiRequests:[],priorRequests:[],nonReadRequests:[],externalRequests:[],staticRequests:[],webSockets:[]},diagnostics:{errors:[],warnings:[]},scenes:[],frames:[],videos:[],styleAssessment:'not assessed; screenshots and playback are review material, not proof of dance genre fidelity/naturalness',success:false};
let browser,context,page;
const persist=()=>writeFile(join(out,'product-preview-receipt.json'),JSON.stringify(report,null,2)+'\n');
try{
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 context=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1,acceptDownloads:true});
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(!['127.0.0.1','localhost'].includes(url.hostname)||url.port!=='5173'||req.method()!=='GET'||url.pathname.startsWith('/api/')||url.pathname.startsWith('/motion-priors/'))return route.abort('blockedbyclient');
  return route.continue();
 });
 page=await context.newPage();
 page.setDefaultTimeout(20000);
 page.on('pageerror',e=>report.diagnostics.errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')report.diagnostics.errors.push(m.text());if(m.type()==='warning')report.diagnostics.warnings.push(m.text());});
 page.on('request',req=>{
  const url=new URL(req.url());
  const line=`${req.method()} ${url.origin}${url.pathname}`;
  if(url.pathname.startsWith('/api/'))report.network.apiRequests.push(line);
  if(url.pathname.startsWith('/motion-priors/'))report.network.priorRequests.push(line);
  if(req.method()!=='GET')report.network.nonReadRequests.push(line);
  if(!['127.0.0.1','localhost'].includes(url.hostname)||url.port!=='5173')report.network.externalRequests.push(line);
  else report.network.staticRequests.push(line);
 });
 page.on('websocket',socket=>report.network.webSockets.push(socket.url()));
 page.on('dialog',dialog=>dialog.type()==='beforeunload'?dialog.accept():dialog.dismiss());
 await page.goto('http://127.0.0.1:5173/');
 const canvas=page.getByRole('img',{name:'人体编舞动作预览',exact:true});
 await canvas.waitFor({state:'visible'});
 await page.waitForFunction(()=>{const c=document.querySelector('canvas[aria-label="人体编舞动作预览"]');return c?.dataset.renderPose&&!document.querySelector('.stage3d-model-loading');});
 await page.locator('.project-title h1').click();
 const closeDetails=async()=>{
  for(let i=0;i<20;i++){
   const details=page.locator('details[open]').last();
   if(!await details.count())break;
   await details.locator(':scope > summary').press('Enter');
  }
 };
 const seek=async time=>{
  await closeDetails();
  await page.getByRole('slider',{name:'时间线进度',exact:true}).evaluate((el,next)=>{
   Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,String(next));
   el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
  },time);
  await page.waitForFunction(next=>Number(document.querySelector('canvas[aria-label="人体编舞动作预览"]')?.dataset.renderTime)===next,time);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 };
 const actualProject=async()=>page.evaluate(async()=>{
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('choreo-studio-preview',2);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const get=(store,key)=>new Promise((resolve,reject)=>{const r=db.transaction(store,'readonly').objectStore(store).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const id=await get('sceneMeta','currentSceneId');
  const value=await get('scenes',id);db.close();
  return {id,name:value.name,project:value.project,audioName:value.audioName};
 });
 for(const entry of inputs){
  // Use the same real encoder/validator that App exports use. No hand renderer,
  // invented human-capture provenance, plan or substitute action data.
  const encoded=await page.evaluate(async({source,patch,label,bytes})=>{
   const {appendAIMotionPatch,validateAIMotionTrack}=await import('/@fs/workspace/ChoreographyStudio/packages/core/src/aiMotionTrack.ts');
   const {sampleTake}=await import('/@fs/workspace/ChoreographyStudio/packages/core/src/index.ts');
   const {createScene}=await import('/src/scene.ts');
   const {encodeSceneBackup}=await import('/src/sceneBackup.ts');
   const track=appendAIMotionPatch(undefined,patch,source.countMap);
   validateAIMotionTrack(track,source.countMap,time=>sampleTake(source.take,time));
   const review=createScene({name:`自有离线评审 · ${label} · GPT6.1`,project:{history:[structuredClone(source),{...structuredClone(source),aiMotion:track}],historyIndex:1,revision:2,audioDuration:32,teacherCheckedRevision:null},audio:new Blob([new Uint8Array(bytes)],{type:'audio/wav'}),audioName:'自造静音32秒.wav',viewer:{camera:null,view:'front',mirror:false,rate:1,loop:false,countSound:false,selectedSlot:0,selectedJoint:null,time:4,editorMode:'keyframes',transformTool:'select',rigMode:'body',gridVisible:true,axesVisible:true}});
   const backup=await encodeSceneBackup(review);
   return {inputSceneId:review.id,name:review.name,bytes:Array.from(new Uint8Array(await backup.arrayBuffer()))};
  },{source,patch:entry.patch,label:entry.label,bytes:Array.from(wav)});
  const reviewPath=join(out,`${entry.style}-owned-review.choreo`);
  await writeFile(reviewPath,Buffer.from(encoded.bytes));
  await page.getByRole('button',{name:'场景',exact:true}).click();
  await page.getByRole('button',{name:'导入场景备份',exact:true}).click();
  await page.getByLabel('选择场景备份文件',{exact:true}).setInputFiles(reviewPath);
  const name=encoded.name;
  await page.getByLabel('导入后的场景名称',{exact:true}).fill(name);
  await page.getByRole('button',{name:'作为新场景导入',exact:true}).click();
  const guard=page.getByRole('dialog',{name:'保留当前场景的修改？',exact:true});
  if(await guard.count())await guard.getByRole('button',{name:'不保存，继续',exact:true}).click();
  await page.locator('.project-title h1').filter({hasText:name}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('.stage3d-model-loading'));
  await page.locator('.project-title h1').click();
  await page.waitForFunction(()=>document.querySelector('audio')?.readyState>=2);
  const saved=await actualProject();
  assert.notEqual(saved.id,encoded.inputSceneId);
  assert.deepEqual(saved.project.history[0],source);
  const active=saved.project.history[saved.project.historyIndex],{aiMotion,...sourceInActive}=active;
  assert.deepEqual(sourceInActive,source);
  assert.deepEqual(aiMotion.patches[0],entry.patch);
  await writeFile(join(out,`${entry.style}-actual-imported-owned-project.json`),JSON.stringify(saved,null,2)+'\n');
  report.scenes.push({style:entry.style,importedSceneId:saved.id,inputSceneId:encoded.inputSceneId,sceneName:saved.name,independentIdentity:true,sourceSnapshotExact:true,activeBaseExact:true,patchExact:true});
  await closeDetails();
  await page.getByRole('button',{name:'正面',exact:true}).click();
  await page.getByRole('button',{name:'全身取景',exact:true}).click();
  const times=entry.style==='chinese-classical'?[3.5,4,4.7,5.8,7.3,8.7,9.5,10]:[4,5.8,7.3,9.5];
  for(const time of times){
   await seek(time);
   const actual=JSON.parse(await canvas.getAttribute('data-render-pose'));
   const expected=await page.evaluate(async({source,patch,time})=>{
    const {createAIMotionSampler,appendAIMotionPatch}=await import('/@fs/workspace/ChoreographyStudio/packages/core/src/aiMotionTrack.ts');
    const {sampleTake}=await import('/@fs/workspace/ChoreographyStudio/packages/core/src/index.ts');
    return createAIMotionSampler(t=>sampleTake(source.take,t),appendAIMotionPatch(undefined,patch,source.countMap))(time);
   },{source,patch:entry.patch,time});
   const maxDiff=Math.max(...expected.root.map((v,i)=>Math.abs(v-actual.root[i])),...Object.keys(expected.joints).flatMap(j=>expected.joints[j].map((v,i)=>Math.abs(v-actual.joints[j][i]))));
   assert.ok(maxDiff<=1e-12,`${entry.style} ${time} actual Stage pose mismatch ${maxDiff}`);
   report.frames.push({style:entry.style,view:'front',time,actualRenderTime:Number(await canvas.getAttribute('data-render-time')),maxExpectedPoseDifference:maxDiff,motionPresentation:await canvas.getAttribute('data-motion-presentation'),pose:actual});
   if(time>=4&&time<=9.5){
    const shot=`${entry.style}-front-${String(time).replace('.','p')}s.png`;
    await page.screenshot({path:join(out,shot),fullPage:true});
    console.log(JSON.stringify({artifact:'screenshot',path:join(out,shot),style:entry.style,time}));
   }
  }
  if(entry.style==='chinese-classical'){
   // Capture the existing WebGL canvas during ordinary 1x app transport.
   await seek(4);
   const captureAvailable=await canvas.evaluate(c=>typeof c.captureStream==='function'&&typeof MediaRecorder==='function');
   if(captureAvailable){
    await canvas.evaluate(c=>{
     const stream=c.captureStream(30),chunks=[];
     const mime=MediaRecorder.isTypeSupported('video/webm;codecs=vp9')?'video/webm;codecs=vp9':'video/webm';
     const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:3000000});
     const capture={stream,recorder,chunks,mime,startWall:performance.now(),samples:[]};
     window.__ownedStageReviewCapture=capture;
     recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
     recorder.start(250);
    });
    await page.getByRole('button',{name:'播放',exact:true}).click();
    await page.waitForFunction(()=>Number(document.querySelector('canvas[aria-label="人体编舞动作预览"]')?.dataset.renderTime)>=9.5,undefined,{timeout:15000});
    const stopRenderTime=Number(await canvas.getAttribute('data-render-time'));
    await page.getByRole('button',{name:'暂停',exact:true}).click();
    const video=await page.evaluate(async()=>{
     const c=window.__ownedStageReviewCapture;
     await new Promise(resolve=>{c.recorder.onstop=resolve;c.recorder.stop();});
     c.stream.getTracks().forEach(track=>track.stop());
     const bytes=new Uint8Array(await new Blob(c.chunks,{type:c.mime}).arrayBuffer());
     let binary='';for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
     const result={base64:btoa(binary),mime:c.mime,wallDurationSeconds:(performance.now()-c.startWall)/1000};
     delete window.__ownedStageReviewCapture;return result;
    });
    const path=join(out,'chinese-classical-native-stage-playback.raw.webm');
    const bytes=Buffer.from(video.base64,'base64');await writeFile(path,bytes);
    report.videos.push({path,bytes:bytes.length,sha256:sha(bytes),mime:video.mime,wallDurationSeconds:video.wallDurationSeconds,startSceneSeconds:4,stopRenderTime,rate:1,scope:'MediaRecorder of the current native Stage canvas during normal app playback; starts/stops include browser scheduling delay. Not yet an exact 5.5-second edit or frame-rate guarantee.'});
    console.log(JSON.stringify({artifact:'video',path,bytes:bytes.length}));
   }
   await page.getByLabel('相机选项',{exact:true}).click();
   await page.getByRole('button',{name:'左侧',exact:true}).click();
   await closeDetails();
   await page.getByRole('button',{name:'全身取景',exact:true}).click();
   for(const time of [5.8,7.3]){
    await seek(time);const shot=`chinese-classical-left-${String(time).replace('.','p')}s.png`;
    await page.screenshot({path:join(out,shot),fullPage:true});
    report.frames.push({style:entry.style,view:'left',time,actualRenderTime:Number(await canvas.getAttribute('data-render-time')),pose:JSON.parse(await canvas.getAttribute('data-render-pose'))});
    console.log(JSON.stringify({artifact:'screenshot',path:join(out,shot),style:entry.style,time,view:'left'}));
   }
  }
  const after=await actualProject();
  assert.deepEqual(after.project,saved.project);
  report.scenes.at(-1).persistedProjectUnchangedByWatching=true;
  await persist();
 }
 assert.deepEqual(report.network.apiRequests,[]);assert.deepEqual(report.network.priorRequests,[]);assert.deepEqual(report.network.nonReadRequests,[]);assert.deepEqual(report.network.externalRequests,[]);
 assert.deepEqual(report.diagnostics.errors,[]);
 report.success=true;
}catch(error){
 report.failure={message:error.message,stack:error.stack};
 if(page){await page.screenshot({path:join(out,'failure-actual-stage.png'),fullPage:true}).catch(()=>{});await writeFile(join(out,'failure-dom.txt'),await page.locator('body').innerText().catch(()=>''));}
 process.exitCode=1;
}finally{
 report.source.fileSHA256After=sha(await readFile(sourcePath));
 report.source.fileBytesUnchanged=report.source.fileSHA256Before===report.source.fileSHA256After;
 report.finishedAtUTC=new Date().toISOString();
 await persist();await context?.close();await browser?.close();
 console.log(JSON.stringify({success:report.success,receipt:join(out,'product-preview-receipt.json'),frames:report.frames.length,scenes:report.scenes.length,api:report.network.apiRequests.length,prior:report.network.priorRequests.length,providerCalls:0,failure:report.failure?.message}));
}

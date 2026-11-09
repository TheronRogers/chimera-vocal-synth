/**
 * Headless-Chromium smoke test: loads the app, starts audio, interacts, collects console errors,
 * measures worklet load, and saves screenshots.
 * Usage: bun tools/e2e.ts [url] [outdir]
 */
import { chromium } from "playwright-core";

import { mkdirSync } from "node:fs";

const url = process.argv[2] ?? "http://127.0.0.1:5318/";
const outDir = process.argv[3] ?? "out/e2e";
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath:process.env.CHIMERA_BROWSER,
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream"],
});
const errors: string[] = [];
const logs: string[] = [];
async function run(viewport: { width: number; height: number }, tag: string) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  page.on("console", (m) => {
    const t = `${m.type()}: ${m.text()}`;
    if (m.type() === "error") errors.push(`[${tag}] ${t}`);
    else logs.push(`[${tag}] ${t}`);
  });
  page.on("pageerror", (e) => errors.push(`[${tag}] pageerror: ${e.message}`));
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${outDir}/${tag}-0-idle.png` });
  await page.getByRole("radio", { name: "Play", exact: true }).click();
  const startBtn = page.getByRole("button", { name: /breathe in and start/i });
  await startBtn.click();
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${outDir}/${tag}-1-running.png` });
  // drag the tongue body handle via the canvas: find it by probing (center-ish of viewport)
  const box = await page.locator(".anatomy canvas").boundingBox();
  if (box) {
    // move over likely tongue area and drag up/forward
    const sx = box.x + box.width * 0.47, sy = box.y + box.height * 0.42;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 40, sy - 30, { steps: 10 });
    await page.mouse.up();
  }
  // vowel map drag
  const vm = await page.locator(".vowel-map").boundingBox();
  if (vm) {
    await page.mouse.move(vm.x + vm.width * 0.2, vm.y + vm.height * 0.2);
    await page.mouse.down();
    await page.mouse.move(vm.x + vm.width * 0.8, vm.y + vm.height * 0.8, { steps: 20 });
    await page.mouse.up();
  }
  await page.keyboard.down("d");
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${outDir}/${tag}-2-played.png` });
  await page.keyboard.up("d");
  const loadText = await page.locator(".load").textContent().catch(() => null);
  logs.push(`[${tag}] load: ${loadText}`);
  // speak mode
  await page.getByRole("radio", { name: "Speak" }).click();
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: /^Speak$/ }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${outDir}/${tag}-3-speak.png`, fullPage: true });
  const trans = await page.locator(".transcription").textContent();
  logs.push(`[${tag}] transcription: ${trans}`);
  // speech breathes by itself: Play's held breath must not drone on once the phrase is over
  const speechRms: number[] = [];
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(250);
    speechRms.push(
      await page.evaluate(() => {
        // @ts-expect-error debug handle
        return window.__chimeraEngine?.latest?.t?.outRms ?? -1;
      }),
    );
  }
  logs.push(`[${tag}] speech rms then silence ${speechRms.map((r) => r.toFixed(4)).join(",")}`);
  if (!(Math.max(...speechRms.slice(-3)) < 1e-3)) errors.push(`[${tag}] voice still sounding after the phrase: ${speechRms.slice(-3).join(",")}`);
  await page.locator("button.ipa", { hasText: "ʃ" }).first().click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${outDir}/${tag}-4-pad.png` });
  // sing mode: a key sings the marked syllable and moves the cursor; legato; a demo song
  await page.getByRole("radio", { name: "Sing" }).click();
  await page.waitForTimeout(600);
  const rms = () =>
    page.evaluate(() => {
      // @ts-expect-error debug handle
      return window.__chimeraEngine?.latest?.t?.outRms ?? -1;
    });
  const nextSyl = () => page.locator(".syl.next").textContent().catch(() => null);
  const sylBefore = await nextSyl();
  await page.keyboard.down("d");
  await page.waitForTimeout(450);
  const singing = await rms();
  await page.keyboard.down("g"); // legato into the next syllable
  await page.waitForTimeout(350);
  await page.keyboard.up("d");
  await page.waitForTimeout(250);
  await page.keyboard.up("g");
  await page.waitForTimeout(900);
  const after = await rms();
  const sylAfter = await nextSyl();
  logs.push(`[${tag}] sing: next syllable ${sylBefore} -> ${sylAfter}, rms while held ${singing.toFixed(4)}, then silence ${after.toFixed(4)}`);
  if (!(singing > 0.01)) errors.push(`[${tag}] a sung key made no sound (${singing})`);
  if (!(after < 1e-3)) errors.push(`[${tag}] voice still sounding after the sung notes: ${after}`);
  if (sylBefore === sylAfter) errors.push(`[${tag}] the syllable cursor did not move (${sylBefore})`);
  await page.getByRole("button", { name: "Made of air" }).click();
  await page.waitForTimeout(2200);
  const demoRms = await rms();
  const demoNow = await page.locator(".syl.now").textContent().catch(() => null);
  await page.screenshot({ path: `${outDir}/${tag}-5-sing.png`, fullPage: tag !== "desktop" });
  await page.getByRole("button", { name: /^Stop “Made of air”$/ }).click();
  await page.waitForTimeout(700);
  const demoStopped = await rms();
  logs.push(`[${tag}] sing demo: rms ${demoRms.toFixed(4)} on "${demoNow}", after stop ${demoStopped.toFixed(4)}`);
  if (!(demoRms > 0.01) || !demoNow) errors.push(`[${tag}] demo song not singing (rms ${demoRms}, syllable ${demoNow})`);
  if (!(demoStopped < 1e-3)) errors.push(`[${tag}] demo still sounding after stop: ${demoStopped}`);
  // bestiary: every creature, its first call, a key in held-voice mode, and the sustain toggle
  await page.getByRole("radio", { name: "Bestiary" }).click();
  await page.waitForTimeout(300);
  const names = await page.locator(".specimen-name").allTextContents();
  for (const [i, name] of names.entries()) {
    await page.locator(".specimen").nth(i).click();
    await page.waitForTimeout(250);
    await page.locator(".call").first().click();
    await page.waitForTimeout(1300);
    const slug = name.toLowerCase().replace(/[^a-z]+/g, "-");
    if (tag === "desktop" || i === 0) await page.screenshot({ path: `${outDir}/${tag}-5-${slug}.png`, fullPage: tag !== "desktop" });
    const state = await page.evaluate(() => {
      // @ts-expect-error debug handle
      const e = window.__chimeraEngine;
      const t = e?.latestCreature?.t;
      return t ? { id: t.id, rms: t.outRms, call: t.call, load: e.load } : null;
    });
    logs.push(`[${tag}] creature ${name}: ${JSON.stringify(state)}`);
  }
  await page.keyboard.down("g");
  await page.waitForTimeout(600);
  const held = await page.evaluate(() => {
    // @ts-expect-error debug handle
    const t = window.__chimeraEngine?.latestCreature?.t;
    return t ? { gate: t.gate, rms: t.outRms } : null;
  });
  await page.keyboard.up("g");
  logs.push(`[${tag}] held key: ${JSON.stringify(held)}`);
  // beatbox: preset, play, playhead + level from telemetry, a pad, stop
  await page.getByRole("radio", { name: "Beatbox" }).click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Breakbeat" }).click();
  await page.getByRole("button", { name: "Play beat" }).click();
  const beatSamples: { step: number; rms: number }[] = [];
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(250);
    beatSamples.push(
      await page.evaluate(() => {
        // @ts-expect-error debug handle
        const t = window.__chimeraEngine?.latest;
        return { step: t?.beatStep ?? -2, rms: t?.t?.outRms ?? -1 };
      }),
    );
  }
  await page.screenshot({ path: `${outDir}/${tag}-6-beatbox.png`, fullPage: tag !== "desktop" });
  logs.push(`[${tag}] beatbox steps ${beatSamples.map((b) => b.step).join(",")} rms ${beatSamples.map((b) => b.rms.toFixed(3)).join(",")}`);
  await page.locator(".pad").first().dispatchEvent("pointerdown");
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Stop" }).click();
  await page.waitForTimeout(300);
  // back to the human voice
  await page.getByRole("radio", { name: "Play" }).click();
  await page.waitForTimeout(600);
  const human = await page.evaluate(() => {
    // @ts-expect-error debug handle
    const e = window.__chimeraEngine;
    return { human: !!e?.latest, creature: !!e?.latestCreature };
  });
  logs.push(`[${tag}] back to play: ${JSON.stringify(human)}`);
  await page.close();
}

// the very first key in Sing mode, before audio has started, still sings once audio is up
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => errors.push(`[first-key] pageerror: ${e.message}`));
  await page.goto(url, { waitUntil: "networkidle" });
  await page.getByRole("radio", { name: "Sing" }).click();
  await page.keyboard.down("d");
  await page.waitForTimeout(1200);
  const level = await page.evaluate(() => {
    // @ts-expect-error debug handle
    return window.__chimeraEngine?.latest?.t?.outRms ?? -1;
  });
  await page.keyboard.up("d");
  logs.push(`[first-key] sing before start: rms ${level.toFixed(4)}`);
  if (!(level > 0.01)) errors.push(`[first-key] the first sung key, pressed before audio started, made no sound (${level})`);
  await page.close();
}

async function guitar(viewport: { width: number; height: number }, tag: string) {
  const page = await browser.newPage({ viewport, hasTouch: true });
  page.on("pageerror", e => errors.push(`[${tag}-guitar] ${e.message}`));
  await page.goto(url, { waitUntil: "networkidle" });
  if (!await page.getByRole("radio", { name: "Guitar", exact: true }).isChecked())
    errors.push(`[${tag}-guitar] Guitar is not selected on startup`);
  const state = (paired = false) => page.evaluate(async (paired) => {
    // @ts-expect-error debug handle
    const e = window.__chimeraEngine;
    // The worklet posts guitar then voice as separate messages. Don't compare a new guitar
    // frame with the previous voice frame while the matching message is still queued.
    if(paired) {
      const deadline=performance.now()+1000;
      while(e?.latestGuitar&&e?.latest&&Math.abs(e.latestGuitar.clock-e.latest.t.clock)>1e-9&&performance.now()<deadline)
        await new Promise(resolve=>setTimeout(resolve,0));
    }
    const t = e?.latestGuitar;
    return t ? { rms:t.rms, playing:t.playing, step:t.step, playhead:t.playhead, clock:t.clock, voiceClock:e.latest?.t.clock, voiceRms:e.latest?.t.outRms, load:e.load, strings:t.strings.map((s:any)=>({fret:s.fret,muted:s.muted,envelope:s.envelope,rms:s.rms})) } : null;
  }, paired);
  await page.locator('.guitar-instrument p').first().click();
  await page.keyboard.press("Space");
  // Cold worklet setup can outlast a fixed delay. Wait for the first audible frame.
  await page.waitForFunction(() => {
    // @ts-expect-error debug handle
    return window.__chimeraEngine?.latestGuitar?.rms > .001;
  }, undefined, { timeout: 4000 }).catch(() => {});
  const playing=await state();
  if(!(playing&&playing.rms>.001&&playing.strings.length===6)) errors.push(`[${tag}-guitar] first keyboard strum failed: ${JSON.stringify(playing)}`);
  await page.getByRole('button',{name:'Stop all',exact:true}).click();
  await page.waitForTimeout(120);
  if((await state())?.rms!==0)errors.push(`[${tag}-guitar] Stop all left guitar sounding`);
  const canvas=page.locator('.guitar-canvas canvas');
  await canvas.scrollIntoViewIfNeeded();
  const b=(await canvas.boundingBox())!;
  const projected=await canvas.evaluate(c=>JSON.parse((c as HTMLCanvasElement).dataset.mutePoints!));
  const point=(i:number,id:number)=>{
    const [x,y]=projected[i];
    return {x:b.x+x,y:b.y+y,id};
  };
  const p=point(0,1);
  await page.mouse.move(p.x,p.y);await page.mouse.down();
  await page.mouse.move(p.x+30,p.y+45,{steps:10});await page.waitForTimeout(100);
  if(!(await state())?.strings[0].muted)errors.push(`[${tag}-guitar] dragging lost the original mute contact`);
  await page.mouse.up();await page.waitForTimeout(120);
  const released=await state();
  if(released?.strings.some((s:any)=>s.muted)||released?.rms!==0)errors.push(`[${tag}-guitar] drag/release excited the string: ${JSON.stringify(released)}`);
  // Two captured touches stay attached to their original strings, including after moving.
  const cdp=await page.context().newCDPSession(page);
  const p0=point(0,1),p5=point(5,2);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p0,p5]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...p0,x:p0.x+20},{...p5,y:p5.y+20}]});
  await page.waitForTimeout(100);
  const touched=await state();
  if(!(touched?.strings[0].muted&&touched.strings[5].muted))errors.push(`[${tag}-guitar] independent touch mutes failed`);
  await page.keyboard.press('Space');await page.waitForTimeout(200);
  const damped=await state();
  if(damped?.strings[0].envelope>1e-7||damped?.strings[5].envelope>1e-7)errors.push(`[${tag}-guitar] strum overrode held mute`);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await page.waitForTimeout(80);
  if((await state())?.strings.some((s:any)=>s.muted))errors.push(`[${tag}-guitar] cancellation left a contact`);
  // Keyboard access to a mute is momentary, and blur releases it.
  const mute=page.getByRole('button',{name:'Hold mute D3',exact:true});
  await mute.focus();await page.keyboard.down('Space');await page.waitForTimeout(80);
  if(!(await state())?.strings[2].muted)errors.push(`[${tag}-guitar] keyboard mute failed`);
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.keyboard.up('Space');await page.waitForTimeout(80);
  if((await state())?.strings.some((s:any)=>s.muted))errors.push(`[${tag}-guitar] blur left a contact`);
  await page.getByRole('button',{name:'F',exact:true}).click();
  await page.getByRole('button',{name:'Strum up ↑',exact:true}).click();await page.waitForTimeout(180);
  const fretted=await state();
  if(JSON.stringify(fretted?.strings.map((s:any)=>s.fret))!==JSON.stringify([1,3,3,2,1,1]))errors.push(`[${tag}-guitar] barre chord did not reach all strings`);
  await page.getByLabel('E4 fret',{exact:true}).selectOption('12');await page.waitForTimeout(150);
  const invalid=await state();
  if(JSON.stringify(invalid?.strings.map((s:any)=>s.fret))!==JSON.stringify(fretted?.strings.map((s:any)=>s.fret)))errors.push(`[${tag}-guitar] invalid draft changed the applied chord`);
  if(!await page.getByRole('alert').count())errors.push(`[${tag}-guitar] invalid draft has no explanation`);
  await page.getByLabel('E4 fret',{exact:true}).selectOption('1');await page.waitForTimeout(150);
  await page.getByRole('button',{name:'Neck back',exact:true}).click();await page.waitForTimeout(150);
  await page.screenshot({path:`${outDir}/${tag}-guitar-back.png`,fullPage:true});
  await page.getByRole('button',{name:'Reset view',exact:true}).click();await page.waitForTimeout(150);
  await page.screenshot({path:`${outDir}/${tag}-guitar.png`,fullPage:true});
  // Standalone transport loops; editing a score does not replace the sounding score.
  await page.getByRole('button',{name:'Play accompaniment',exact:true}).click();await page.waitForTimeout(600);
  if(!(await state())?.playing)errors.push(`[${tag}-guitar] progression did not start`);
  await page.getByRole('spinbutton',{name:'Guitar tempo',exact:true}).fill('120');
  await page.getByRole('button',{name:'Stop accompaniment',exact:true}).click();
  await page.getByRole('checkbox',{name:'With singer',exact:true}).check();
  await page.waitForFunction(()=>document.querySelector<HTMLCanvasElement>('.guitar-canvas canvas')?.dataset.singer==='true');
  const framing=await canvas.evaluate(c=>({tip:JSON.parse((c as HTMLCanvasElement).dataset.headstock!),w:c.clientWidth,h:c.clientHeight}));
  if(framing.tip[0]<0||framing.tip[0]>framing.w||framing.tip[1]<0||framing.tip[1]>framing.h)
    errors.push(`[${tag}-guitar] combined performer clips the headstock`);
  if(!await page.getByRole('img',{name:/3D singer and guitarist as one performer/}).count())
    errors.push(`[${tag}-guitar] combined performer is missing from the guitar scene`);
  if(!await page.getByRole('heading',{name:'Vocal track',exact:true}).count()||!await page.locator('.s-guitar-singer .anatomy canvas').count())
    errors.push(`[${tag}-guitar] combined performer lost the vocal track or singer details`);
  const instrument=(await page.locator('.s-guitar').boundingBox())!;
  const singer=(await page.locator('.s-guitar-singer').boundingBox())!;
  const editors=(await page.locator('.guitar-editors').boundingBox())!;
  if(viewport.width>=1100) {
    if(Math.abs(instrument.y-singer.y)>1||singer.x<instrument.x+instrument.width)
      errors.push(`[${tag}-guitar] singer details are not beside the performer`);
  } else if(singer.y<instrument.y+instrument.height)
    errors.push(`[${tag}-guitar] stacked singer details overlap the performer`);
  if(editors.y<Math.max(instrument.y+instrument.height,singer.y+singer.height))
    errors.push(`[${tag}-guitar] editors precede or overlap the performance`);
  for(const name of ['Made of air','Twinkle, twinkle']) {
    await page.getByRole('combobox',{name:'Guitar singer song',exact:true}).selectOption(name);
    await page.getByRole('button',{name:'Play accompaniment',exact:true}).click();
    await page.waitForTimeout(2200);
    const duet=await state();
    if(!(duet?.playing&&duet.voiceRms>1e-6&&duet.rms>.00001))errors.push(`[${tag}-guitar] singer and guitar did not sound together: ${name} ${JSON.stringify(duet)}`);
    await page.waitForFunction(()=>!!document.querySelector<HTMLCanvasElement>('.guitar-canvas canvas')?.dataset.syllable);
    const clocks=[];
    for(let i=0;i<12;i++){await page.waitForTimeout(100);clocks.push(await state(true));}
    const loads=clocks.map(s=>s?.load??1),mean=loads.reduce((a,b)=>a+b,0)/loads.length;
    if(mean>=.7)errors.push(`[${tag}-guitar] combined load ${(mean*100).toFixed(1)}% exceeds 70%`);
    const offsets=clocks.map(s=>s!.voiceClock-s!.clock);
    if(Math.max(...offsets)-Math.min(...offsets)>.004||offsets.some(x=>Math.abs(x)>.004))errors.push(`[${tag}-guitar] singer/guitar clocks drifted`);
    logs.push(`[${tag}] ${name} combined load ${(mean*100).toFixed(1)}%, levels ${duet?.rms}/${duet?.voiceRms}`);
    await page.screenshot({path:`${outDir}/${tag}-guitar-singer-${name.startsWith('Made')?'air':'twinkle'}.png`,fullPage:true});
    await page.getByRole('button',{name:'Stop accompaniment',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector<HTMLCanvasElement>('.guitar-canvas canvas')?.dataset.syllable);
  }
  await page.getByRole('button',{name:'Play accompaniment',exact:true}).click();await page.waitForTimeout(600);
  await page.getByRole('combobox',{name:'Guitar singer voice',exact:true}).selectOption('female');await page.waitForTimeout(150);
  if((await state())?.playing)errors.push(`[${tag}-guitar] body switch did not stop performance`);
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))errors.push(`[${tag}-guitar] horizontal overflow`);
  await page.getByRole('radio',{name:'Play',exact:true}).click();
  await page.getByRole('radio',{name:'Guitar',exact:true}).click();await page.waitForTimeout(150);
  const reset=await state();
  if(reset?.playing||reset?.strings.some((s:any)=>s.muted)||reset?.rms!==0)errors.push(`[${tag}-guitar] mode switch did not clear playback`);
  logs.push(`[${tag}] guitar initial audio ${playing?.rms}, two touch mutes passed`);
  await page.close();
}
async function drums() {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on("pageerror", e => errors.push(`[drums] ${e.message}`));
  await page.goto(url, { waitUntil: "networkidle" });
  await page.getByRole("radio", { name: "Drums", exact: true }).click();
  await page.getByRole("img", { name: /3D drummer/ }).waitFor();
  await page.getByRole("button", { name: "Snare", exact: true }).click();
  await page.waitForFunction(() => {
    // @ts-expect-error debug handle
    return window.__chimeraEngine?.latestDrums?.last[1] >= 0;
  });
  await page.getByRole("button", { name: "Stop drums", exact: true }).click();
  await page.waitForFunction(() => {
    // @ts-expect-error debug handle
    return window.__chimeraEngine?.latestDrums?.last[1] === -1;
  });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
    errors.push("[drums] horizontal overflow");
  await page.screenshot({ path: `${outDir}/mobile-drums.png`, fullPage: true });
  await page.close();
}

await drums();
await guitar({width:1440,height:980},"desktop");
await guitar({width:390,height:844},"mobile");

await run({ width: 1440, height: 980 }, "desktop");
await run({ width: 390, height: 844 }, "mobile");
await browser.close();
console.log("console errors:", errors.length ? "\n" + errors.join("\n") : "none");
console.log(logs.filter((l) => /load|warn|transcription|creature|held|back to|beatbox|silence|sing/i.test(l)).slice(0, 40).join("\n"));
// a run that collected errors fails, so CI and agents can't read it as a pass
if (errors.length) process.exit(1);

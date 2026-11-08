import { fingerChord, STRING_NAMES, type Chord, type Frets } from "../../guitar/model.ts";
import type { GuitarTelemetry } from "../../worklet/protocol.ts";
import { V } from "../colors.ts";

const WIDTH=1000, HEIGHT=540;
export const NUT=160, BRIDGE=855, STRING_TOP=240, STRING_GAP=13;
type Point=[number,number];

// Bass strings run from the nearest post to the furthest; treble strings return
// along the other edge. The winding post and tuning key share the same shaft.
export const TUNERS = [124,90,56,56,90,124].map((x,i)=>({
  post: [x,i<3?232:313] as Point,
  key: [x,i<3?200:345] as Point,
}));

/** A portrait camera on phones keeps the entire guitar and both wrists on screen. */
export function guitarCamera(w:number,h:number) {
  const portrait=w<600;
  const scale=Math.min(w/(portrait?HEIGHT:WIDTH),h/(portrait?WIDTH:HEIGHT));
  const x=(w-(portrait?HEIGHT:WIDTH)*scale)/2, y=(h-(portrait?WIDTH:HEIGHT)*scale)/2;
  return {portrait,scale,x,y};
}
export function guitarPoint(w:number,h:number,x:number,y:number): [number,number] {
  const c=guitarCamera(w,h);
  return c.portrait ? [(y-c.y)/c.scale,(x-c.x)/c.scale] : [WIDTH-(x-c.x)/c.scale,(y-c.y)/c.scale];
}
/** Front view of a right-handed player: body left, neck right; neck up on phones. */
export function guitarScreenPoint(w:number,h:number,x:number,y:number): Point {
  const c=guitarCamera(w,h);
  return [c.x+(c.portrait?y:WIDTH-x)*c.scale,c.y+(c.portrait?x:y)*c.scale];
}
export function muteStringAt(w:number,h:number,x:number,y:number):number|null {
  const [gx,gy]=guitarPoint(w,h,x,y);
  if (gx<700 || gx>890 || gy<STRING_TOP-STRING_GAP/2 || gy>STRING_TOP+5.5*STRING_GAP) return null;
  return Math.max(0,Math.min(5,Math.round((gy-STRING_TOP)/STRING_GAP)));
}

const fretX=(f:number)=>NUT+(BRIDGE-NUT)*(1-Math.pow(2,-f/12));

/** Paint short reaches first so fingers reaching across the neck stay in front. */
export function handFingers(cx:number,cy:number,tips:Point[],above:boolean,barreFinger?:number) {
  const s=above?1:-1;
  return tips.map(([tx,ty],finger)=>{
    const bx=finger===0?cx-35:cx-27+(finger-1)*20,by=finger===0?cy-s*20:cy+s*5;
    const joint:Point=[bx+(tx-bx)*.45+(finger===0?-12:0),by+(ty-by)*.5];
    const points:Point[]=[[bx,by],joint];
    // A bent last phalanx approaches from beside the contact. A straight reach
    // would run through the fingertip on the next string at the same fret.
    if(!above&&finger>0&&ty<=STRING_TOP+5*STRING_GAP) {
      const gap=Math.min(...tips.filter(([,y],i)=>i>0&&y<=STRING_TOP+5*STRING_GAP)
        .map(([x])=>Math.abs(x-tx)).filter(d=>d>.01));
      const approach=tx-Math.min(18,gap*.45);
      joint[0]=finger===barreFinger?tx:approach;
      points.push(finger===barreFinger?[tx,STRING_TOP+5*STRING_GAP+10]:[approach,ty+15]);
    }
    points.push([tx,ty]);
    return {finger,points,reach:(ty-cy)*s};
  }).sort((a,b)=>a.reach-b.reach||a.finger-b.finger);
}

export function frettingHandPose(frets:Frets) {
  const posed=fingerChord(frets), contacts=frets.filter(f=>f>0);
  const base=contacts.length?Math.min(...contacts):1;
  const x=Math.max(221,Math.min(530,fretX(base)+36)),y=391;
  const tips:Point[]=[[x-68,339]];
  for(let finger=1;finger<=4;finger++) {
    const indices=frets.map((_,i)=>i).filter(i=>posed.fingers?.[i]===finger);
    if(indices.length) {
      const i=posed.barre?.finger===finger?indices[0]:indices[indices.length-1];
      tips.push([(fretX(frets[i])+fretX(frets[i]-1))/2,STRING_TOP+i*STRING_GAP]);
    } else tips.push([x-35+finger*22,347+(finger%2)*9]);
  }
  return {x,y,tips,barreFinger:posed.barre?.finger};
}

export function drawGuitar(ctx:CanvasRenderingContext2D,w:number,h:number,chord:Chord,t:GuitarTelemetry|null):void {
  const c=guitarCamera(w,h);
  ctx.save(); ctx.translate(c.x,c.y); ctx.scale(c.scale,c.scale);
  if (c.portrait) { ctx.translate(0,WIDTH); ctx.rotate(-Math.PI/2); }
  ctx.translate(WIDTH,0);ctx.scale(-1,1);
  const path=(points:Point[],color:string,width=1.5,close=false) => {
    ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();
    points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));
    if(close)ctx.closePath();ctx.stroke();
  };
  const text=(s:string,x:number,y:number,color=V.blue,size=13) => {
    ctx.save();ctx.translate(x,y);ctx.scale(-1,1);if(c.portrait)ctx.rotate(Math.PI/2);
    ctx.textAlign="right";
    ctx.font=`${Math.max(size,8/c.scale)}px Hershey, monospace`;ctx.fillStyle=color;ctx.fillText(s,0,0);ctx.restore();
  };
  const circle=(x:number,y:number,r:number,color:string,fill=false)=>{ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.strokeStyle=color;ctx.lineWidth=1.5;if(fill){ctx.fillStyle="#000";ctx.fill();}ctx.stroke();};
  // The waist separates the upper and lower bouts; the neck visibly joins the soundboard.
  ctx.strokeStyle=V.blue;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(615,225);
  ctx.bezierCurveTo(535,170,610,75,697,100);ctx.bezierCurveTo(754,116,735,162,780,152);
  ctx.bezierCurveTo(861,64,979,120,975,267);ctx.bezierCurveTo(979,426,863,480,780,394);
  ctx.bezierCurveTo(735,385,754,431,697,449);ctx.bezierCurveTo(610,473,535,377,615,321);
  ctx.closePath();ctx.stroke();
  circle(736,272,53,V.blue);circle(736,272,58,V.blueDim);circle(736,272,62,V.blueDim);
  path([[NUT,227],[631,227],[631,318],[NUT,318]],V.blue,2,true);
  path([[36,228],[144,214],[NUT,227],[NUT,318],[144,331],[36,317]],V.blue,2,true);
  path([[842,218],[868,218],[868,327],[842,327]],V.blue,2,true);
  for(const {post,key} of TUNERS) {
    path([post,key],V.blue);
    circle(...key,5,V.blue);
    circle(...post,3,V.blue);
  }
  for(let f=0;f<=12;f++) {
    const x=fretX(f);path([[x,227],[x,318]],V.blue,f===0?4:1);
    if([3,5,7,9,12].includes(f)) { const mid=(x+fretX(f-1))/2;circle(mid,272,2,V.blue);if(f===12)circle(mid,291,2,V.blue); }
    if([1,3,5,7,9,12].includes(f)) text(String(f),x-9,210,V.blueDim,12);
  }
  const frets=(t?.strings.map(s=>s.fret) ?? chord.frets) as Frets;
  const posed=fingerChord(frets);
  for(let i=0;i<6;i++) {
    const y=STRING_TOP+i*STRING_GAP, string=t?.strings[i];
    const color=string?.muted||frets[i]<0?V.blueDim:V.amber;
    path([TUNERS[i].post,[NUT,y]],V.blueDim);
    const samples=string?.displacement;
    const env=Math.min(9,(string?.envelope??0)*2200);
    if(env>0.05) {ctx.globalAlpha=.2;path(Array.from({length:65},(_,n)=>[NUT+(BRIDGE-NUT)*n/64,y+Math.sin(Math.PI*n/64)*env] as Point),color,1);ctx.globalAlpha=1;}
    path(Array.from({length:257},(_,n)=>[NUT+(BRIDGE-NUT)*n/256,y+(samples?.[n]??0)*2200] as Point),color,1.9-i*.18);
    circle(BRIDGE,y,2,V.blue);
    if(!c.portrait)text(STRING_NAMES[i],5,y+4,color,12);
    if(frets[i]>0) {
      const x=(fretX(frets[i])+fretX(frets[i]-1))/2;
      circle(x,y,7,posed.fingers?.[i]?V.green:V.amber,true);
      if(!posed.fingers?.[i])text("!",x-3,y+4,V.amber,11);
    } else if(frets[i]<0) {
      path([[NUT-18,y-3],[NUT-12,y+3]],color);path([[NUT-18,y+3],[NUT-12,y-3]],color);
    } else circle(NUT-15,y,3,color);
    if(string?.muted)circle(813,y,10,V.pink);
  }
  if(posed.barre) {
    const b=posed.barre,x=(fretX(b.fret)+fretX(b.fret-1))/2;
    path([[x,STRING_TOP+b.from*STRING_GAP],[x,STRING_TOP+b.to*STRING_GAP]],V.green,5);
  }
  // Each hand has a palm, thumb, and four separately jointed fingers. Thick outlined
  // strokes allow fingers to overlap naturally without merging into one silhouette.
  const hand=(cx:number,cy:number,tips:Point[],above:boolean,barreFinger?:number) => {
    const s=above?1:-1;
    const palm:Point[]=[[cx-38,cy],[cx-35,cy-s*42],[cx+26,cy-s*45],[cx+43,cy-s*5],[cx+25,cy+s*17],[cx-24,cy+s*15]];
    ctx.beginPath();palm.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fillStyle="#000";ctx.fill();ctx.strokeStyle=V.blue;ctx.lineWidth=1.7;ctx.stroke();
    path([[cx-29,cy-s*40],[cx-23,cy-s*84],[cx+20,cy-s*86],[cx+27,cy-s*43]],V.blue,1.7);
    handFingers(cx,cy,tips,above,barreFinger).forEach(({finger,points})=>{
      const joint=points[1];
      ctx.lineCap="round";ctx.lineJoin="round";
      path(points,V.blue,finger===0?15:13);
      path(points,"#000",finger===0?11.5:9.5);
      path([[joint[0]-3,joint[1]],[joint[0]+3,joint[1]]],V.blueDim,1);
    });
    ctx.lineCap="butt";
  };
  const fretting=frettingHandPose(frets);
  hand(fretting.x,fretting.y,fretting.tips,false,fretting.barreFinger);
  const dt=t ? t.clock-t.strumTime : 99;
  const strumming=dt>=0&&dt<.14;
  const sweep=Math.min(1,dt/.08);
  const mute=t?.strings.findIndex(s=>s.muted) ?? -1;
  const pickY=mute>=0?STRING_TOP+mute*STRING_GAP:strumming?STRING_TOP-8+(t!.direction<0?1-sweep:sweep)*83:217;
  hand(838,137,[[756,215],[813,pickY],[845,216],[872,206],[894,190]],true);
  if(mute>=0)circle(813,pickY,8,V.pink);
  if(!c.portrait) {
    text("648 MM  /  STANDARD TUNING",585,506,V.blueDim,13);
    text("FRET",180,470,V.green,13);text("STRUM / TOUCH TO MUTE",734,37,V.pink,13);
  }
  ctx.restore();
}

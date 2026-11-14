"use strict";

const TYPES = {
  battery:  {label:"Battery",   prefix:"B", pins:["pos","neg"], value:9,     unit:"V"},
  acsource: {label:"AC source", prefix:"V", pins:["pos","neg"], value:5,     unit:"V", hertz:50},
  resistor: {label:"Resistor",  prefix:"R", pins:["a","b"],     value:1000,  unit:"Ω"},
  capacitor:{label:"Capacitor", prefix:"C", pins:["a","b"],     value:100e-6,unit:"F"},
  inductor: {label:"Inductor",  prefix:"L", pins:["a","b"],     value:0.1,   unit:"H"},
  diode:    {label:"Diode",     prefix:"D", pins:["a","k"]},
  led:      {label:"LED",       prefix:"D", pins:["a","k"]},
  switch:   {label:"Switch",    prefix:"S", pins:["a","b"],     closed:true},
  ground:   {label:"Ground",    prefix:"G", pins:["g"]},
};
const GRID = 20, COLORS = ["#B5612A","#0F7F78","#5B4FB3","#C2912B","#2D6CB5","#A63D6B","#4C7A2E","#7A5A3A"];
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

const SI = {p:1e-12,n:1e-9,u:1e-6,"µ":1e-6,m:1e-3,k:1e3,K:1e3,M:1e6,G:1e9};
function parseSI(s){
  const m = String(s).trim().match(/^([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\s*(meg|[pnuµmkKMG])?/i);
  if(!m) return NaN;
  let mult = 1;
  if(m[2]) mult = m[2].toLowerCase()==="meg" ? 1e6 : SI[m[2]] ?? SI[m[2].toLowerCase()];
  return parseFloat(m[1]) * mult;
}
function fmtSI(x, unit=""){
  if(!isFinite(x) || Math.abs(x) < 1e-12) return "0 "+unit;
  const a = Math.abs(x), steps = [[1e9,"G"],[1e6,"M"],[1e3,"k"],[1,""],[1e-3,"m"],[1e-6,"µ"],[1e-9,"n"],[1e-12,"p"]];
  for(const [v,p] of steps) if(a >= v*0.9995){ const n = x/v; return `${+n.toPrecision(3)} ${p}${unit}`; }
  return `${x.toExponential(1)} ${unit}`;
}

let comps = [], wires = [], counters = {}, selected = null, tool = null;
let wiring = null, hoverPin = null, drag = null, mouse = {x:0,y:0};
let result = null, scopeMode = "v", hidden = new Set(), cursorT = null;
const board = document.getElementById("board"), bctx = board.getContext("2d");
const scope = document.getElementById("scope"), sctx = scope.getContext("2d");

function pinLocal(c, i){
  const n = TYPES[c.type].pins.length;
  return n === 1 ? [0,0] : [i===0 ? -40 : 40, 0];
}
function toWorld(c, p){
  const [x,y] = p, a = c.rot*Math.PI/2, cs = Math.round(Math.cos(a)), sn = Math.round(Math.sin(a));
  return [c.x + x*cs - y*sn, c.y + x*sn + y*cs];
}
function toLocal(c, wx, wy){
  const dx = wx-c.x, dy = wy-c.y, a = -c.rot*Math.PI/2, cs = Math.round(Math.cos(a)), sn = Math.round(Math.sin(a));
  return [dx*cs - dy*sn, dx*sn + dy*cs];
}
const pinKey = (c,i) => c.id+":"+i;
function pinPos(key){
  const [id,i] = key.split(":"), c = comps.find(c=>c.id===id);
  return c ? toWorld(c, pinLocal(c,+i)) : [0,0];
}
function pinAt(x,y){
  for(const c of comps) for(let i=0;i<TYPES[c.type].pins.length;i++){
    const [px,py] = toWorld(c, pinLocal(c,i));
    if(Math.hypot(px-x,py-y) < 10) return pinKey(c,i);
  }
  return null;
}
function compAt(x,y){
  for(let k=comps.length-1;k>=0;k--){
    const c = comps[k], [lx,ly] = toLocal(c,x,y);
    const box = c.type==="ground" ? [-16,16,-6,30] : [-30,30,-18,18];
    if(lx>=box[0] && lx<=box[1] && ly>=box[2] && ly<=box[3]) return c;
  }
  return null;
}
function route(w){
  const [x1,y1] = pinPos(w.a), [x2,y2] = pinPos(w.b);
  return [[x1,y1],[x2,y1],[x2,y2]];
}
function wireAt(x,y){
  for(const w of wires){
    const pts = route(w);
    for(let i=0;i<2;i++){
      const [ax,ay] = pts[i], [bx,by] = pts[i+1], dx = bx-ax, dy = by-ay, L = dx*dx+dy*dy;
      const t = L ? Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/L)) : 0;
      if(Math.hypot(ax+t*dx-x, ay+t*dy-y) < 6) return w;
    }
  }
  return null;
}

function computeNets(){
  const parent = {};
  const find = k => { parent[k] ??= k; while(parent[k]!==k){ parent[k]=parent[parent[k]]; k=parent[k]; } return k; };
  const union = (a,b) => { parent[find(a)] = find(b); };
  for(const c of comps) for(let i=0;i<TYPES[c.type].pins.length;i++){
    find(pinKey(c,i)); if(c.type==="ground") union(pinKey(c,i),"GND");
  }
  for(const w of wires) union(w.a,w.b);
  const names = {}; let n = 0; names[find("GND")] = "GND";
  const netOf = {};
  for(const c of comps) for(let i=0;i<TYPES[c.type].pins.length;i++){
    const r = find(pinKey(c,i));
    if(!(r in names)) names[r] = "n"+(++n);
    netOf[pinKey(c,i)] = names[r];
  }
  return netOf;
}

function drawSymbol(g, c, bright){
  const ink = css("--ink"), t = c.type;
  g.strokeStyle = ink; g.fillStyle = ink; g.lineWidth = 2; g.lineCap = "round"; g.lineJoin = "round";
  const line = (...p) => { g.beginPath(); g.moveTo(p[0],p[1]); for(let i=2;i<p.length;i+=2) g.lineTo(p[i],p[i+1]); g.stroke(); };
  if(t==="resistor"){
    line(-40,0,-24,0,-20,-9,-12,9,-4,-9,4,9,12,-9,20,9,24,0,40,0);
  } else if(t==="battery"){
    line(-40,0,-6,0); line(6,0,40,0); line(-6,-14,-6,14); line(6,-7,6,7);
    g.lineWidth = 3; line(6,-7,6,7); g.lineWidth = 1.5;
    g.font = "bold 13px sans-serif"; g.fillText("+",-24,-6);
  } else if(t==="acsource"){
    line(-40,0,-16,0); line(16,0,40,0);
    g.beginPath(); g.arc(0,0,16,0,Math.PI*2); g.stroke();
    g.beginPath(); for(let x=-10;x<=10;x++){ const y=-6*Math.sin(x/10*Math.PI); x===-10?g.moveTo(x,y):g.lineTo(x,y);} g.stroke();
  } else if(t==="capacitor"){
    line(-40,0,-5,0); line(5,0,40,0); line(-5,-14,-5,14); line(5,-14,5,14);
  } else if(t==="inductor"){
    line(-40,0,-24,0); line(24,0,40,0);
    g.beginPath(); for(let k=0;k<4;k++){ g.arc(-18+12*k,0,6,Math.PI,0,false); } g.stroke();
  } else if(t==="diode" || t==="led"){
    if(t==="led" && bright>0){
      const gr = g.createRadialGradient(0,0,2,0,0,36); gr.addColorStop(0,`rgba(240,70,40,${0.75*bright})`); gr.addColorStop(1,"rgba(240,70,40,0)");
      g.fillStyle = gr; g.beginPath(); g.arc(0,0,36,0,Math.PI*2); g.fill(); g.fillStyle = ink;
    }
    line(-40,0,-10,0); line(10,0,40,0);
    g.beginPath(); g.moveTo(-10,-12); g.lineTo(-10,12); g.lineTo(10,0); g.closePath();
    g.fillStyle = t==="led" ? `rgba(240,70,40,${0.25+0.7*bright})` : "transparent"; g.fill(); g.stroke(); g.fillStyle = ink;
    line(10,-12,10,12);
    if(t==="led"){ line(2,-16,10,-26); line(10,-26,5,-25); line(10,-26,9,-21); line(10,-12,18,-22); line(18,-22,13,-21); line(18,-22,17,-17); }
  } else if(t==="switch"){
    line(-40,0,-18,0); line(18,0,40,0);
    g.beginPath(); g.arc(-18,0,3,0,7); g.arc(18,0,3,0,7); g.fillStyle = css("--paper"); g.fill(); g.stroke();
    c.closed ? line(-18,0,18,0) : line(-18,0,14,-16);
  } else if(t==="ground"){
    line(0,0,0,12); line(-14,12,14,12); line(-9,18,9,18); line(-4,24,4,24);
  }
}
function drawLabel(g, c){
  const tp = TYPES[c.type]; if(c.type==="ground") return;
  let val = "";
  if(tp.unit) val = fmtSI(c.value, tp.unit) + (c.type==="acsource" ? ` ${c.hertz} Hz` : "");
  const fin = result?.final.components[c.id];
  g.fillStyle = css("--ink"); g.font = "600 12px 'Avenir Next','Segoe UI',sans-serif"; g.textBaseline = "alphabetic";
  const vert = c.rot%2===1, x = vert ? c.x+24 : c.x, y = vert ? c.y-6 : c.y-28;
  g.textAlign = vert ? "left" : "center";
  g.fillText(c.id + (val ? "  "+val : ""), x, y);
  if(fin){ g.font = "12px 'Avenir Next','Segoe UI',sans-serif"; g.fillStyle = css("--teal");
    g.fillText(`${fmtSI(Math.abs(fin.i),"A")}  ${fmtSI(Math.abs(fin.v),"V")}`, x, y+14); }
}
function drawBoard(){
  const W = board.clientWidth, H = board.clientHeight, dpr = devicePixelRatio||1;
  if(board.width !== W*dpr || board.height !== H*dpr){ board.width = W*dpr; board.height = H*dpr; }
  bctx.setTransform(dpr,0,0,dpr,0,0); bctx.clearRect(0,0,W,H);
  const netOf = computeNets(), degree = {};

  for(const w of wires){
    const pts = route(w); degree[w.a] = (degree[w.a]||0)+1; degree[w.b] = (degree[w.b]||0)+1;
    bctx.strokeStyle = w===selected ? css("--teal") : css("--copper"); bctx.lineWidth = w===selected ? 4 : 2.5; bctx.lineJoin = "round";
    bctx.beginPath(); bctx.moveTo(...pts[0]); bctx.lineTo(...pts[1]); bctx.lineTo(...pts[2]); bctx.stroke();
  }

  for(const c of comps){
    const fin = result?.final.components[c.id];
    if(c===selected){
      bctx.save(); bctx.translate(c.x,c.y); bctx.rotate(c.rot*Math.PI/2);
      bctx.fillStyle = "rgba(15,127,120,.12)"; bctx.strokeStyle = css("--teal"); bctx.setLineDash([4,3]);
      const b = c.type==="ground" ? [-20,-4,40,38] : [-42,-20,84,40]; bctx.fillRect(...b); bctx.strokeRect(...b); bctx.restore();
    }
    bctx.save(); bctx.translate(c.x,c.y); bctx.rotate(c.rot*Math.PI/2);
    drawSymbol(bctx, c, fin?.brightness ?? 0); bctx.restore();
    drawLabel(bctx, c);
    for(let i=0;i<TYPES[c.type].pins.length;i++){
      const k = pinKey(c,i), [px,py] = toWorld(c, pinLocal(c,i)), lit = k===hoverPin || k===wiring;
      bctx.beginPath(); bctx.arc(px,py,lit?6:(degree[k]>1?4.5:3),0,7);
      bctx.fillStyle = lit ? css("--teal") : (degree[k] ? css("--copper") : css("--paper"));
      bctx.fill(); bctx.lineWidth = 1.5; bctx.strokeStyle = lit ? css("--teal") : css("--ink"); bctx.stroke();
    }
  }

  if(result){
    const seen = new Set(["GND"]); bctx.font = "600 11.5px 'Avenir Next','Segoe UI',sans-serif"; bctx.textAlign = "left";
    for(const [k,net] of Object.entries(netOf)){
      if(seen.has(net) || !(net in result.final.nodes)) continue; seen.add(net);
      const [px,py] = pinPos(k), txt = `${net}: ${fmtSI(result.final.nodes[net],"V")}`, w = bctx.measureText(txt).width+10;
      bctx.fillStyle = css("--ink"); bctx.beginPath(); bctx.roundRect(px+6,py-24,w,17,3); bctx.fill();
      bctx.fillStyle = "#fff"; bctx.fillText(txt, px+11, py-11.5);
    }
  }

  if(wiring){
    const [x1,y1] = pinPos(wiring); bctx.strokeStyle = css("--teal"); bctx.setLineDash([5,4]); bctx.lineWidth = 2;
    bctx.beginPath(); bctx.moveTo(x1,y1); bctx.lineTo(mouse.x,y1); bctx.lineTo(mouse.x,mouse.y); bctx.stroke(); bctx.setLineDash([]);
  }
  if(tool){
    bctx.save(); bctx.globalAlpha = .45; bctx.translate(snap(mouse.x), snap(mouse.y)); drawSymbol(bctx,{type:tool,closed:true},0); bctx.restore();
  }
}

const snap = v => Math.round(v/GRID)*GRID;
function nextId(type){
  const p = TYPES[type].prefix; counters[p] = (counters[p]||0)+1; return p+counters[p];
}
function addPart(type, x, y, rot=0, value, extra={}){
  const tp = TYPES[type];
  const c = {id:nextId(type), type, x:snap(x), y:snap(y), rot, value: value ?? tp.value, hertz: tp.hertz, closed: tp.closed ?? true, ...extra};
  comps.push(c); return c;
}
function removeSelected(){
  if(!selected) return;
  if(selected.type){ wires = wires.filter(w => !w.a.startsWith(selected.id+":") && !w.b.startsWith(selected.id+":")); comps = comps.filter(c=>c!==selected); }
  else wires = wires.filter(w=>w!==selected);
  selected = null; changed();
}
function changed(){ renderInspector(); drawBoard(); if(document.getElementById("auto").checked) scheduleRun(); else { result = null; drawBoard(); drawScope(); } }

board.addEventListener("pointerdown", e => {
  board.focus(); const r = board.getBoundingClientRect(); mouse = {x:e.clientX-r.left, y:e.clientY-r.top};
  if(tool){ const c = addPart(tool, mouse.x, mouse.y); selected = c; if(!e.shiftKey) setTool(null); changed(); return; }
  const pin = pinAt(mouse.x, mouse.y);
  if(pin){
    if(!wiring) wiring = pin;
    else if(wiring !== pin){
      if(!wires.some(w => (w.a===wiring&&w.b===pin)||(w.a===pin&&w.b===wiring))) wires.push({a:wiring,b:pin});
      wiring = null; changed();
    }
    drawBoard(); return;
  }
  wiring = null;
  const c = compAt(mouse.x, mouse.y);
  if(c){ selected = c; drag = {c, dx:mouse.x-c.x, dy:mouse.y-c.y, sx:mouse.x, sy:mouse.y, moved:false}; board.setPointerCapture(e.pointerId); }
  else selected = wireAt(mouse.x, mouse.y);
  renderInspector(); drawBoard();
});
board.addEventListener("pointermove", e => {
  const r = board.getBoundingClientRect(); mouse = {x:e.clientX-r.left, y:e.clientY-r.top};
  hoverPin = pinAt(mouse.x, mouse.y);
  if(drag){
    if(Math.hypot(mouse.x-drag.sx, mouse.y-drag.sy) > 3) drag.moved = true;
    if(drag.moved){ drag.c.x = snap(mouse.x-drag.dx); drag.c.y = snap(mouse.y-drag.dy); }
  }
  drawBoard();
});
board.addEventListener("pointerup", () => {
  if(drag){
    if(!drag.moved && drag.c.type==="switch"){ drag.c.closed = !drag.c.closed; }
    drag = null; changed();
  }
});
addEventListener("keydown", e => {
  if(["INPUT","SELECT","TEXTAREA"].includes(document.activeElement.tagName)) return;
  if(e.key==="Delete" || e.key==="Backspace"){ e.preventDefault(); removeSelected(); }
  else if(e.key==="Escape"){ wiring = null; setTool(null); drawBoard(); }
  else if((e.key==="r"||e.key==="R") && selected?.type){ selected.rot = (selected.rot+1)%4; changed(); }
});

function setTool(t){
  tool = t; board.style.cursor = t ? "copy" : "crosshair";
  document.querySelectorAll("#parts button").forEach(b => b.classList.toggle("on", b.dataset.type===t));
  drawBoard();
}
(function buildPalette(){
  const el = document.getElementById("parts");
  for(const [type,tp] of Object.entries(TYPES)){
    const b = document.createElement("button"); b.dataset.type = type;
    const cv = document.createElement("canvas"); cv.width = 68; cv.height = 36; cv.style.cssText = "width:34px;height:18px";
    const g = cv.getContext("2d"); g.translate(34,18); g.scale(.8,.8); drawSymbol(g,{type,closed:true},0);
    b.append(cv, tp.label); b.onclick = () => setTool(tool===type ? null : type); el.append(b);
  }
})();

function renderInspector(){
  const el = document.getElementById("inspector"), c = selected;
  if(!c){
    el.innerHTML = `<h2>Inspector</h2><p>Select a part to edit its value.</p>
    <p><b>Wire:</b> click one pin, then another.<br><b>Move:</b> drag a part.<br><b>Rotate:</b> press R.<br><b>Delete:</b> press Delete.<br><b>Switch:</b> click it to open or close.</p>`;
    return;
  }
  if(!c.type){ el.innerHTML = `<h2>Wire</h2><div class="btns"><button id="del">Delete wire</button></div>`; document.getElementById("del").onclick = removeSelected; return; }
  const tp = TYPES[c.type]; let h = `<h2>${tp.label} ${c.id}</h2>`;
  if(tp.unit) h += `<div class="row"><label for="val">${c.type==="acsource"?"Peak":"Value"}</label><input type="text" id="val" value="${fmtSI(c.value,"").trim()}"> <span>${tp.unit}</span></div>`;
  if(c.type==="acsource") h += `<div class="row"><label for="hz">Frequency</label><input type="text" id="hz" value="${c.hertz}"> <span>Hz</span></div>`;
  if(c.type==="switch") h += `<div class="row"><label for="cl">Closed</label><input type="checkbox" id="cl" ${c.closed?"checked":""}></div>`;
  const f = result?.final.components[c.id];
  if(f) h += `<table><tr><td>Voltage</td><td>${fmtSI(f.v,"V")}</td></tr><tr><td>Current</td><td>${fmtSI(f.i,"A")}</td></tr><tr><td>Power</td><td>${fmtSI(f.p,"W")}</td></tr></table>
    <p>Positive power means the part absorbs energy; negative means it supplies it.</p>`;
  h += `<div class="btns"><button id="rot">Rotate</button><button id="del">Delete</button></div>`;
  el.innerHTML = h;
  const val = document.getElementById("val");
  if(val) val.onchange = () => { const v = parseSI(val.value); if(v>0){ c.value = v; changed(); } else val.value = fmtSI(c.value,"").trim(); };
  const hz = document.getElementById("hz");
  if(hz) hz.onchange = () => { const v = parseSI(hz.value); if(v>0){ c.hertz = v; changed(); } };
  const cl = document.getElementById("cl"); if(cl) cl.onchange = () => { c.closed = cl.checked; changed(); };
  document.getElementById("rot").onclick = () => { c.rot = (c.rot+1)%4; changed(); };
  document.getElementById("del").onclick = removeSelected;
}

let runTimer = null;
const scheduleRun = () => { clearTimeout(runTimer); runTimer = setTimeout(run, 150); };
function setStatus(msg, err){ const s = document.getElementById("status"); s.textContent = msg; s.className = err ? "err" : ""; }
async function run(){
  const netOf = computeNets(), parts = comps.filter(c=>c.type!=="ground");
  if(!parts.length){ result = null; setStatus(""); drawBoard(); drawScope(); return; }
  if(!comps.some(c=>c.type==="ground")){ setStatus("Add a ground to the circuit.", true); return; }
  const payload = {
    t_end: parseSI(document.getElementById("tend").value), steps: parseInt(document.getElementById("steps").value),
    components: parts.map(c => ({id:c.id, type:c.type, value:c.value, hertz:c.hertz, closed:c.closed,
      nodes: TYPES[c.type].pins.map((_,i)=>netOf[pinKey(c,i)])})),
  };
  if(!(payload.t_end>0) || !(payload.steps>0)){ setStatus("Duration and steps must be positive numbers.", true); return; }
  try{
    const res = await fetch("/api/simulate", {method:"POST", body:JSON.stringify(payload)});
    const data = await res.json();
    if(!res.ok){ setStatus(data.error, true); return; }
    result = data; setStatus(`Simulated ${fmtSI(payload.t_end,"s")} in ${payload.steps} steps.`);
    hidden = new Set([...hidden].filter(k => k.startsWith(scopeMode)));
    renderInspector(); renderChips(); drawBoard(); drawScope();
  }catch(err){ setStatus("Cannot reach the Python server. Is server.py still running?", true); }
}

function signals(){
  if(!result) return [];
  return scopeMode==="v"
    ? Object.keys(result.nodes).filter(n=>n!=="GND").map(n => ({key:"v:"+n, name:n, data:result.nodes[n], unit:"V"}))
    : Object.keys(result.components).map(n => ({key:"i:"+n, name:n, data:result.components[n].i, unit:"A"}));
}
function renderChips(){
  const el = document.getElementById("chips"); el.innerHTML = "";
  signals().forEach((s,i) => {
    const d = document.createElement("div"); d.className = "chip"+(hidden.has(s.key)?" off":"");
    d.innerHTML = `<i style="background:${COLORS[i%COLORS.length]}"></i>${s.name}`;
    d.onclick = () => { hidden.has(s.key) ? hidden.delete(s.key) : hidden.add(s.key); renderChips(); drawScope(); };
    el.append(d);
  });
}
function drawScope(){
  const W = scope.clientWidth, H = scope.clientHeight, dpr = devicePixelRatio||1;
  if(scope.width !== W*dpr || scope.height !== H*dpr){ scope.width = W*dpr; scope.height = H*dpr; }
  sctx.setTransform(dpr,0,0,dpr,0,0); sctx.clearRect(0,0,W,H);
  sctx.font = "11.5px 'Avenir Next','Segoe UI',sans-serif";
  const sigs = signals(), shown = sigs.filter(s=>!hidden.has(s.key));
  if(!result){ sctx.fillStyle = css("--muted"); sctx.fillText("Build a circuit and press Simulate to see its signals here.", 20, H/2); return; }
  const L = 62, R = 14, T = 8, B = 22, pw = W-L-R, ph = H-T-B, t = result.t, t0 = 0, t1 = t[t.length-1];
  let lo = Infinity, hi = -Infinity;
  for(const s of shown) for(const v of s.data){ if(v<lo) lo=v; if(v>hi) hi=v; }
  if(!isFinite(lo)){ lo = 0; hi = 1; }
  if(hi-lo < 1e-12){ lo -= 1; hi += 1; }
  const pad = (hi-lo)*0.08; lo -= pad; hi += pad;
  const X = x => L + (x-t0)/(t1-t0)*pw, Y = y => T + (1-(y-lo)/(hi-lo))*ph, unit = scopeMode==="v" ? "V" : "A";
  sctx.strokeStyle = "rgba(31,45,61,.12)"; sctx.fillStyle = css("--muted"); sctx.lineWidth = 1; sctx.textAlign = "right";
  for(let i=0;i<=4;i++){ let v = lo+(hi-lo)*i/4; if(Math.abs(v) < (hi-lo)*1e-6) v = 0; const y = Y(v); sctx.beginPath(); sctx.moveTo(L,y); sctx.lineTo(L+pw,y); sctx.stroke(); sctx.fillText(fmtSI(v,unit), L-6, y+4); }
  for(let i=0;i<=5;i++){ sctx.textAlign = i===5 ? "right" : "center"; const tv = t0+(t1-t0)*i/5, x = X(tv); sctx.beginPath(); sctx.moveTo(x,T); sctx.lineTo(x,T+ph); sctx.stroke(); sctx.fillText(fmtSI(tv,"s"), x, H-6); }
  if(lo<0 && hi>0){ sctx.strokeStyle = "rgba(31,45,61,.4)"; sctx.beginPath(); sctx.moveTo(L,Y(0)); sctx.lineTo(L+pw,Y(0)); sctx.stroke(); }
  sigs.forEach((s,i) => {
    if(hidden.has(s.key)) return;
    sctx.strokeStyle = COLORS[i%COLORS.length]; sctx.lineWidth = 2; sctx.beginPath();
    s.data.forEach((v,k) => k ? sctx.lineTo(X(t[k]),Y(v)) : sctx.moveTo(X(t[k]),Y(v))); sctx.stroke();
  });
  const ro = document.getElementById("readout");
  if(cursorT!==null){
    const k = Math.max(0, Math.min(t.length-1, Math.round(cursorT/t1*(t.length-1))));
    sctx.strokeStyle = css("--ink"); sctx.beginPath(); sctx.moveTo(X(t[k]),T); sctx.lineTo(X(t[k]),T+ph); sctx.stroke();
    ro.textContent = `t = ${fmtSI(t[k],"s")}   ` + shown.map(s => `${s.name} ${fmtSI(s.data[k],unit)}`).join("   ");
  } else ro.textContent = "";
}
scope.addEventListener("pointermove", e => {
  if(!result) return; const r = scope.getBoundingClientRect(), L = 62, pw = r.width-L-14;
  const f = (e.clientX-r.left-L)/pw; cursorT = f>=0 && f<=1 ? f*result.t[result.t.length-1] : null; drawScope();
});
scope.addEventListener("pointerleave", () => { cursorT = null; drawScope(); });
document.querySelectorAll(".tabs button").forEach(b => b.onclick = () => {
  scopeMode = b.dataset.mode; document.querySelectorAll(".tabs button").forEach(x=>x.classList.toggle("on",x===b)); renderChips(); drawScope();
});

function build(spec){
  comps = []; wires = []; counters = {}; selected = null; result = null;
  const byName = {};
  for(const p of spec.parts){ const c = addPart(p[0], p[1], p[2], p[3], p[4], p[5]||{}); byName[p[6]||c.id] = c; }
  const ref = s => { const [n,pin] = s.split("."); const c = byName[n]; return c.id+":"+TYPES[c.type].pins.indexOf(pin); };
  for(const [a,b] of spec.wires) wires.push({a:ref(a), b:ref(b)});
  document.getElementById("tend").value = spec.t; document.getElementById("steps").value = spec.steps || 2000;
  changed(); run();
}
const PRESETS = {
  "Voltage divider (9 V, 1k + 2k)": {t:"1m", parts:[["battery",120,200,1,9],["resistor",240,160,0,1000],["resistor",360,200,1,2000],["ground",240,300,0]],
    wires:[["B1.pos","R1.a"],["R1.b","R2.a"],["R2.b","G1.g"],["B1.neg","G1.g"]]},
  "LED with series resistor": {t:"1m", parts:[["battery",120,200,1,9],["resistor",240,160,0,470],["led",360,200,1],["ground",240,300,0]],
    wires:[["B1.pos","R1.a"],["R1.b","D1.a"],["D1.k","G1.g"],["B1.neg","G1.g"]]},
  "RC charging (τ = 100 ms)": {t:"0.5", parts:[["battery",120,200,1,5],["switch",240,160,0],["resistor",360,160,0,1000],["capacitor",480,200,1,100e-6],["ground",300,300,0]],
    wires:[["B1.pos","S1.a"],["S1.b","R1.a"],["R1.b","C1.a"],["C1.b","G1.g"],["B1.neg","G1.g"]]},
  "RC low-pass filter (100 Hz AC)": {t:"40m", parts:[["acsource",120,200,1,5,{hertz:100}],["resistor",240,160,0,1000],["capacitor",360,200,1,1e-6],["ground",240,300,0]],
    wires:[["V1.pos","R1.a"],["R1.b","C1.a"],["C1.b","G1.g"],["V1.neg","G1.g"]]},
  "Half-wave rectifier + smoothing": {t:"60m", parts:[["acsource",120,200,1,5,{hertz:50}],["diode",240,160,0],["resistor",380,200,1,1000],["capacitor",500,200,1,10e-6],["ground",280,300,0]],
    wires:[["V1.pos","D1.a"],["D1.k","R1.a"],["D1.k","C1.a"],["R1.b","G1.g"],["C1.b","G1.g"],["V1.neg","G1.g"]]},
  "Series RLC ringing": {t:"20m", parts:[["battery",120,200,1,5],["resistor",240,160,0,10],["inductor",360,160,0,0.01],["capacitor",480,200,1,100e-6],["ground",300,300,0]],
    wires:[["B1.pos","R1.a"],["R1.b","L1.a"],["L1.b","C1.a"],["C1.b","G1.g"],["B1.neg","G1.g"]]},
};
const presetSel = document.getElementById("preset");
Object.keys(PRESETS).forEach(k => presetSel.add(new Option(k,k)));
presetSel.onchange = () => { if(presetSel.value) build(PRESETS[presetSel.value]); };
document.getElementById("run").onclick = run;
document.getElementById("clear").onclick = () => { comps = []; wires = []; counters = {}; selected = null; result = null; setStatus(""); renderInspector(); renderChips(); drawBoard(); drawScope(); };
document.getElementById("auto").onchange = e => { if(e.target.checked) run(); };
for(const id of ["tend","steps"]) document.getElementById(id).onchange = () => document.getElementById("auto").checked && run();
addEventListener("resize", () => { drawBoard(); drawScope(); });

renderInspector(); build(PRESETS["LED with series resistor"]); presetSel.value = "LED with series resistor";

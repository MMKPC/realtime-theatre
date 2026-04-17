// ─────────────────────────────────────────────────────────────
// RealTime Theatre — client
// Talks to the FastAPI backend for the backdrop + scene
// classification, then drives a procedural particle renderer
// and a 2D host avatar in-browser.
//
// Configure the backend URL by setting window.__API__ before
// this script loads, or override the default below.
// ─────────────────────────────────────────────────────────────

// Resolution order:
//   1. window.__API__ override (for custom deployments)
//   2. A proxied port placeholder that gets rewritten by the dev deploy tool
//   3. Same-origin '' (Vercel, any single-host deploy)
//   4. localhost:8000 (local dev, file://)
const API = (() => {
  if (typeof window === 'undefined') return '';
  if (window.__API__) return window.__API__;
  const port = '__PORT_8000__';
  if (!port.startsWith('__')) return port;
  const { protocol, hostname } = window.location;
  if (protocol === 'file:' || hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'http://localhost:8000';
  }
  // Same-origin: backend is served at /api/* by the same host (e.g. Vercel)
  return '';
})();

// ================================================================
// DOM
// ================================================================
const $ = (id) => document.getElementById(id);
const form = $('promptForm');
const input = $('promptInput');
const btn = $('generateBtn');
const basePlate = $('basePlate');
const canvas = $('vfx');
const grade = $('grade');
const sceneLabel = $('sceneLabel');
const sceneTitle = $('sceneTitle');
const sceneSub = $('sceneSub');
const meta = $('meta');
const hostEl = $('host');
const hostBody = $('hostBody');
const hostHead = $('hostHead');
const hostShadow = $('hostShadow');
const armLeft = $('armLeft');
const armRight = $('armRight');
const mouth = $('mouth');
const eyes = document.querySelectorAll('#eyes .eye');
const bubble = $('bubble');
const bubbleText = $('bubbleText');
const hostToggle = $('hostToggle');

// ================================================================
// Canvas
// ================================================================
const ctx = canvas.getContext('2d');
let W = 0, H = 0, DPR = Math.min(window.devicePixelRatio || 1, 2);

function resize(){
  const r = canvas.getBoundingClientRect();
  W = r.width; H = r.height;
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  ctx.setTransform(DPR,0,0,DPR,0,0);
}
window.addEventListener('resize', resize);

// Parallax pointer
let px = 0.5, py = 0.5, tpx = 0.5, tpy = 0.5;
window.addEventListener('pointermove', (e) => {
  tpx = e.clientX / window.innerWidth;
  tpy = e.clientY / window.innerHeight;
});
window.addEventListener('deviceorientation', (e) => {
  if (e.gamma != null && e.beta != null){
    tpx = 0.5 + Math.max(-1, Math.min(1, e.gamma / 30)) * 0.5;
    tpy = 0.5 + Math.max(-1, Math.min(1, e.beta  / 45)) * 0.5;
  }
});

// ================================================================
// Scene state
// ================================================================
let scene = {
  type: 'waterfall',
  palette: ['#0a1b2f', '#164a6e', '#2bd4c4', '#e6faff', '#ffcf6e'],
  time_of_day: 'sunset',
  mood: 'calm',
  modifiers: [],
};

// Particle pools — lazy-created based on scene
let systems = [];

// ================================================================
// Random + utility
// ================================================================
const rand = (a = 1, b) => b === undefined ? Math.random() * a : a + Math.random() * (b - a);
const choice = (arr) => arr[Math.floor(Math.random() * arr.length)];

function hexToRgb(hex){
  const h = hex.replace('#','');
  const n = parseInt(h, 16);
  return [ (n>>16)&255, (n>>8)&255, n&255 ];
}
function rgba(hex, a){
  const [r,g,b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

// ================================================================
// Particle systems
// Each has: spawn(), step(dt), draw()
// ================================================================

function WaterfallSystem(palette){
  // Vertical sheets of bright droplets + foam basin + rising mist
  const droplets = [];
  const foam = [];
  const mist = [];
  const maxDroplets = 520;
  const maxMist = 90;

  function spawnDroplet(){
    // Spawn in a vertical band ~ 35% - 65% of width (the "falls")
    const x = W * rand(0.32, 0.68);
    droplets.push({
      x, y: rand(-40, H * 0.2),
      vx: rand(-0.2, 0.2),
      vy: rand(340, 720), // px / sec
      len: rand(8, 26),
      w: rand(1, 2.2),
      life: 1,
      c: choice([palette[2], palette[3], '#ffffff']),
    });
  }
  function spawnFoam(x, y){
    foam.push({
      x, y, vx: rand(-60, 60), vy: rand(-180, -40),
      r: rand(2, 5), life: 1, c: palette[3],
    });
  }
  function spawnMist(){
    mist.push({
      x: W * rand(0.2, 0.8),
      y: H * rand(0.55, 0.9),
      vx: rand(-10, 10),
      vy: rand(-30, -8),
      r: rand(40, 110),
      life: 1,
      a: rand(0.05, 0.18),
      c: palette[3],
    });
  }

  return {
    step(dt){
      // spawn
      const need = Math.min(maxDroplets - droplets.length, 30);
      for (let i = 0; i < need; i++) spawnDroplet();
      if (mist.length < maxMist && Math.random() < 0.6) spawnMist();

      // update droplets
      for (let i = droplets.length - 1; i >= 0; i--){
        const d = droplets[i];
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        d.vy += 1200 * dt; // gravity-ish
        if (d.y > H * 0.82){
          // splash at basin
          for (let k = 0; k < 2; k++) spawnFoam(d.x + rand(-6,6), H * rand(0.78,0.85));
          droplets.splice(i,1);
        }
      }
      // update foam
      for (let i = foam.length - 1; i >= 0; i--){
        const f = foam[i];
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.vy += 380 * dt;
        f.life -= dt * 1.4;
        if (f.life <= 0) foam.splice(i,1);
      }
      // update mist
      for (let i = mist.length - 1; i >= 0; i--){
        const m = mist[i];
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        m.r += 14 * dt;
        m.life -= dt * 0.22;
        if (m.life <= 0) mist.splice(i,1);
      }
    },
    draw(){
      // droplets
      ctx.lineCap = 'round';
      for (const d of droplets){
        ctx.strokeStyle = rgba(d.c, 0.75);
        ctx.lineWidth = d.w;
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x + d.vx * 0.02, d.y - d.len);
        ctx.stroke();
      }
      // foam
      for (const f of foam){
        ctx.fillStyle = rgba(f.c, Math.max(0, f.life) * 0.9);
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill();
      }
      // mist
      for (const m of mist){
        const g = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.r);
        g.addColorStop(0, rgba(m.c, m.a * Math.max(0, m.life)));
        g.addColorStop(1, rgba(m.c, 0));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2); ctx.fill();
      }
    },
  };
}

function RainSystem(palette, { heavy = true } = {}){
  const drops = [];
  const max = heavy ? 520 : 240;
  const angle = -0.25;
  return {
    step(dt){
      while (drops.length < max){
        drops.push({
          x: rand(-100, W + 100),
          y: rand(-H, 0),
          len: rand(8, 22),
          sp: rand(600, 1100),
        });
      }
      for (const d of drops){
        d.x += d.sp * angle * dt;
        d.y += d.sp * dt;
        if (d.y > H){
          d.y = rand(-H * 0.5, 0);
          d.x = rand(-100, W + 100);
        }
      }
    },
    draw(){
      ctx.strokeStyle = rgba(palette[3], 0.55);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const d of drops){
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x + d.len * angle, d.y + d.len);
      }
      ctx.stroke();
    },
  };
}

function SnowSystem(palette){
  const flakes = [];
  const max = 260;
  return {
    step(dt){
      while (flakes.length < max){
        flakes.push({
          x: rand(0, W), y: rand(-H, 0),
          r: rand(1.2, 3.6),
          sp: rand(30, 110),
          drift: rand(-0.8, 0.8),
          phase: rand(0, Math.PI * 2),
        });
      }
      for (const f of flakes){
        f.phase += dt * 1.2;
        f.x += (Math.sin(f.phase) * 18 + f.drift * 30) * dt;
        f.y += f.sp * dt;
        if (f.y > H + 5){ f.y = -10; f.x = rand(0, W); }
      }
    },
    draw(){
      for (const f of flakes){
        ctx.fillStyle = rgba('#ffffff', 0.85);
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill();
      }
    },
  };
}

function FireSystem(palette){
  const embers = [];
  const plumes = [];
  const max = 260;
  return {
    step(dt){
      while (embers.length < max){
        embers.push({
          x: W * rand(0.35, 0.65) + rand(-30, 30),
          y: H * rand(0.7, 0.98),
          vx: rand(-40, 40),
          vy: rand(-260, -120),
          life: rand(0.6, 1.6),
          r: rand(1.2, 3.2),
          c: choice([palette[2], palette[3], '#ffb347', '#ff3d2e']),
        });
      }
      for (let i = embers.length - 1; i >= 0; i--){
        const e = embers[i];
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        e.vy += 60 * dt;
        e.life -= dt;
        if (e.life <= 0) embers.splice(i,1);
      }
      if (plumes.length < 18 && Math.random() < 0.7){
        plumes.push({
          x: W * rand(0.3, 0.7), y: H * rand(0.75, 0.95),
          r: rand(60, 160), life: rand(0.8, 1.6),
          c: choice(['#ff6e2e', '#ffb347', palette[2]]),
        });
      }
      for (let i = plumes.length - 1; i >= 0; i--){
        const p = plumes[i];
        p.y -= 70 * dt;
        p.r += 50 * dt;
        p.life -= dt;
        if (p.life <= 0) plumes.splice(i,1);
      }
    },
    draw(){
      for (const p of plumes){
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
        g.addColorStop(0, rgba(p.c, Math.max(0, p.life) * 0.35));
        g.addColorStop(1, rgba(p.c, 0));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      }
      for (const e of embers){
        ctx.fillStyle = rgba(e.c, Math.max(0, Math.min(1, e.life)));
        ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2); ctx.fill();
      }
    },
  };
}

function MistSystem(palette, { density = 1 } = {}){
  const blobs = [];
  const max = Math.round(70 * density);
  return {
    step(dt){
      while (blobs.length < max){
        blobs.push({
          x: rand(-80, W + 80),
          y: H * rand(0.4, 1),
          r: rand(60, 180),
          vx: rand(-12, 12),
          vy: rand(-6, 4),
          a: rand(0.04, 0.12),
        });
      }
      for (const b of blobs){
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        if (b.x < -200) b.x = W + 200;
        if (b.x > W + 200) b.x = -200;
      }
    },
    draw(){
      for (const b of blobs){
        const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
        g.addColorStop(0, rgba(palette[3], b.a));
        g.addColorStop(1, rgba(palette[3], 0));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
      }
    },
  };
}

function StarsSystem(palette){
  const stars = [];
  const shooting = [];
  const max = 200;
  return {
    step(dt){
      while (stars.length < max){
        stars.push({
          x: rand(0, W), y: rand(0, H * 0.9),
          r: rand(0.4, 1.8),
          a: rand(0.3, 1),
          tw: rand(0.5, 2.5),
          t: rand(0, 6),
        });
      }
      for (const s of stars){ s.t += dt * s.tw; }
      if (shooting.length < 2 && Math.random() < 0.008){
        shooting.push({
          x: rand(0, W), y: rand(0, H * 0.5),
          vx: rand(-420, -200), vy: rand(80, 180),
          life: 1,
        });
      }
      for (let i = shooting.length - 1; i >= 0; i--){
        const s = shooting[i];
        s.x += s.vx * dt; s.y += s.vy * dt;
        s.life -= dt * 1.2;
        if (s.life <= 0) shooting.splice(i,1);
      }
    },
    draw(){
      for (const s of stars){
        const a = s.a * (0.6 + 0.4 * Math.sin(s.t));
        ctx.fillStyle = rgba('#ffffff', a);
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.lineCap = 'round';
      for (const s of shooting){
        const g = ctx.createLinearGradient(s.x, s.y, s.x - s.vx*0.1, s.y - s.vy*0.1);
        g.addColorStop(0, rgba('#ffffff', Math.max(0, s.life)));
        g.addColorStop(1, rgba('#ffffff', 0));
        ctx.strokeStyle = g;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x - s.vx * 0.1, s.y - s.vy * 0.1);
        ctx.stroke();
      }
    },
  };
}

function CosmicSystem(palette){
  // Swirling stardust + slow nebula bands — sits on top of stars
  const dust = [];
  const max = 420;
  const cx = () => W * 0.55, cy = () => H * 0.45;
  return {
    step(dt){
      while (dust.length < max){
        const r = rand(60, Math.max(W, H) * 0.6);
        const a = rand(0, Math.PI * 2);
        dust.push({
          r, a,
          speed: rand(0.05, 0.22),
          size: rand(0.6, 2.6),
          c: choice([palette[2], palette[3], palette[4], '#ffffff']),
          alpha: rand(0.25, 0.85),
        });
      }
      for (const d of dust){
        d.a += d.speed * dt;
      }
    },
    draw(){
      for (const d of dust){
        const x = cx() + Math.cos(d.a) * d.r;
        const y = cy() + Math.sin(d.a) * d.r * 0.55;
        ctx.fillStyle = rgba(d.c, d.alpha);
        ctx.beginPath(); ctx.arc(x, y, d.size, 0, Math.PI * 2); ctx.fill();
      }
    },
  };
}

function FirefliesSystem(palette, { count = 70 } = {}){
  const bugs = [];
  return {
    step(dt){
      while (bugs.length < count){
        bugs.push({
          x: rand(0, W), y: rand(H * 0.3, H),
          vx: rand(-20, 20), vy: rand(-20, 20),
          t: rand(0, 6), pulse: rand(1.2, 2.8),
        });
      }
      for (const b of bugs){
        b.t += dt * b.pulse;
        b.vx += rand(-30, 30) * dt;
        b.vy += rand(-30, 30) * dt;
        b.vx = Math.max(-40, Math.min(40, b.vx));
        b.vy = Math.max(-40, Math.min(40, b.vy));
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        if (b.x < 0) b.x = W; if (b.x > W) b.x = 0;
        if (b.y < 0) b.y = H; if (b.y > H) b.y = 0;
      }
    },
    draw(){
      for (const b of bugs){
        const a = 0.55 + 0.45 * Math.sin(b.t);
        const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, 12);
        g.addColorStop(0, rgba(palette[4] || '#c6f27a', a));
        g.addColorStop(1, rgba(palette[4] || '#c6f27a', 0));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(b.x, b.y, 12, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = rgba('#ffffff', a * 0.9);
        ctx.beginPath(); ctx.arc(b.x, b.y, 1.2, 0, Math.PI * 2); ctx.fill();
      }
    },
  };
}

function NeonReflectionsSystem(palette){
  // Soft colored light pillars on the lower half (cyberpunk feel)
  const pillars = [];
  const max = 10;
  return {
    step(dt){
      while (pillars.length < max){
        pillars.push({
          x: rand(0, W),
          w: rand(40, 140),
          c: choice([palette[2], palette[3], palette[4], '#ff3df2', '#1affd5']),
          t: rand(0, 6),
          sp: rand(0.4, 1.3),
        });
      }
      for (const p of pillars) p.t += dt * p.sp;
    },
    draw(){
      for (const p of pillars){
        const a = 0.08 + 0.05 * Math.sin(p.t);
        const g = ctx.createLinearGradient(p.x, H * 0.55, p.x, H);
        g.addColorStop(0, rgba(p.c, 0));
        g.addColorStop(1, rgba(p.c, a));
        ctx.fillStyle = g;
        ctx.fillRect(p.x - p.w/2, H * 0.55, p.w, H * 0.45);
      }
    },
  };
}

// ================================================================
// Scene → systems
// ================================================================
function buildSystems(s){
  const p = s.palette;
  const list = [];
  switch (s.type){
    case 'waterfall':
      list.push(WaterfallSystem(p));
      list.push(MistSystem(p, { density: 0.8 }));
      break;
    case 'ocean':
      list.push(MistSystem(p, { density: 0.5 }));
      list.push(RainSystem(p, { heavy: false }));
      break;
    case 'rain':
      list.push(RainSystem(p, { heavy: true }));
      list.push(MistSystem(p, { density: 0.6 }));
      break;
    case 'snow':
      list.push(SnowSystem(p));
      list.push(MistSystem(p, { density: 0.3 }));
      break;
    case 'fire':
      list.push(FireSystem(p));
      list.push(MistSystem(p, { density: 0.4 }));
      break;
    case 'forest':
      list.push(MistSystem(p, { density: 0.4 }));
      if (s.time_of_day === 'night') list.push(FirefliesSystem(p));
      break;
    case 'cosmic':
      list.push(StarsSystem(p));
      list.push(CosmicSystem(p));
      break;
    case 'city':
      list.push(NeonReflectionsSystem(p));
      if (s.modifiers.includes('rain') || /night/.test(s.time_of_day)){
        list.push(RainSystem(p, { heavy: true }));
      }
      break;
    case 'desert':
      list.push(MistSystem(p, { density: 0.2 }));
      break;
    default:
      list.push(MistSystem(p, { density: 0.4 }));
  }

  if (s.modifiers.includes('rain') && s.type !== 'rain' && s.type !== 'city'){
    list.push(RainSystem(p, { heavy: false }));
  }
  if (s.modifiers.includes('snow') && s.type !== 'snow'){
    list.push(SnowSystem(p));
  }
  if (s.modifiers.includes('mist') && !['waterfall','rain','snow','forest','ocean','fire','desert'].includes(s.type)){
    list.push(MistSystem(p, { density: 0.5 }));
  }
  if (s.time_of_day === 'night' && s.type !== 'cosmic' && s.type !== 'city'){
    list.push(StarsSystem(p));
  }
  return list;
}

function applyGrade(s){
  const p = s.palette;
  // Build a color-graded overlay from the palette
  const c1 = rgba(p[0], 0.25);
  const c2 = rgba(p[1], 0.12);
  const c3 = rgba(p[2], 0.08);
  grade.style.background = `
    radial-gradient(ellipse at 50% 35%, ${c3} 0%, transparent 60%),
    radial-gradient(ellipse at 50% 100%, ${c1} 0%, transparent 70%),
    linear-gradient(180deg, transparent 60%, ${c2} 100%)
  `;
}

// ================================================================
// Main loop — particles, parallax on base plate + canvas
// ================================================================
let last = performance.now();
function frame(now){
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;

  // smooth parallax
  px += (tpx - px) * 0.08;
  py += (tpy - py) * 0.08;

  // base plate subtle parallax scale
  const tx = (px - 0.5) * -14;
  const ty = (py - 0.5) * -8;
  basePlate.style.transform = `scale(1.06) translate3d(${tx}px, ${ty}px, 0)`;

  // clear and draw
  ctx.clearRect(0, 0, W, H);

  // slight canvas parallax
  ctx.save();
  ctx.translate((px - 0.5) * -10, (py - 0.5) * -6);

  for (const sys of systems){
    sys.step(dt);
    sys.draw();
  }
  ctx.restore();

  stepHost(now, dt);

  requestAnimationFrame(frame);
}

// ================================================================
// Fetch + render
// ================================================================
async function generate(prompt){
  btn.classList.add('loading');
  btn.disabled = true;
  meta.textContent = 'Generating base plate…';
  sceneLabel.textContent = 'working';

  try{
    const res = await fetch(`${API}/api/scene`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, aspect_ratio: '16:9' }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data.error || !data.image){
      meta.textContent = `Image generation failed: ${data.error || 'unknown'} — VFX overlay still active.`;
    }

    if (data.image){
      basePlate.classList.remove('ready');
      basePlate.onload = () => basePlate.classList.add('ready');
      basePlate.src = data.image;
    }

    scene = data.scene;
    systems = buildSystems(scene);
    applyGrade(scene);

    sceneLabel.textContent = `${scene.type} · ${scene.time_of_day} · ${scene.mood}`;
    sceneTitle.textContent = prompt;
    sceneSub.textContent = `Live particles: ${describeSystems(scene)}. Move your mouse — the stage parallaxes.`;
    if (!data.error){
      meta.textContent = `Palette ${scene.palette.join(' · ')} · drives blending and particle color.`;
    }
    hostSay(hostLineFor(scene, prompt));
  }catch(err){
    meta.textContent = `Error: ${err.message}. VFX overlay still running.`;
  }finally{
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

function describeSystems(s){
  const parts = [];
  if (s.type === 'waterfall') parts.push('water sheets, basin foam, rising mist');
  if (s.type === 'rain')      parts.push('angled rain, low fog');
  if (s.type === 'snow')      parts.push('drifting snow');
  if (s.type === 'fire')      parts.push('embers, smoke plumes');
  if (s.type === 'forest' && s.time_of_day === 'night') parts.push('fireflies, drifting fog');
  if (s.type === 'forest' && s.time_of_day !== 'night') parts.push('drifting fog');
  if (s.type === 'cosmic')    parts.push('twinkling stars, swirling stardust, shooting stars');
  if (s.type === 'city')      parts.push('neon light pillars, reflections');
  if (s.type === 'ocean')     parts.push('sea mist, light drizzle');
  if (s.type === 'desert')    parts.push('dust haze');
  for (const m of s.modifiers){
    if (m === 'rain')  parts.push('secondary rain');
    if (m === 'snow')  parts.push('secondary snow');
    if (m === 'mist')  parts.push('secondary mist');
  }
  if (s.time_of_day === 'night' && !['cosmic','city'].includes(s.type)) parts.push('stars');
  return parts.join(', ') || 'ambient atmosphere';
}

// ================================================================
// Hookup
// ================================================================
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const v = input.value.trim();
  if (v) generate(v);
});
for (const chip of document.querySelectorAll('.chip')){
  chip.addEventListener('click', () => {
    const p = chip.getAttribute('data-p');
    input.value = p;
    generate(p);
  });
}

// ================================================================
// Host avatar animation
// ================================================================
let hostT = 0;
let waveUntil = 0;
let blinkUntil = 0;
let nextBlink = 2 + Math.random() * 3;

function stepHost(now, dt){
  hostT += dt;
  // idle breathing: body scale + head bob
  const breathe = Math.sin(hostT * 1.6) * 0.015;
  const bob = Math.sin(hostT * 1.6) * 1.2;

  // parallax: slight horizontal lean based on pointer
  const lean = (px - 0.5) * -6;
  hostBody.setAttribute('transform',
    `translate(${lean} ${-bob * 0.4}) scale(${1 + breathe} ${1 - breathe})`);
  hostHead.setAttribute('transform', `translate(0 ${bob}) rotate(${lean * 0.4} 100 120)`);
  hostShadow.setAttribute('rx', 55 - Math.abs(breathe) * 60);

  // blink
  if (hostT > nextBlink && !blinkUntil){ blinkUntil = hostT + 0.13; }
  const blinking = hostT < blinkUntil;
  for (const e of eyes){
    e.setAttribute('transform', blinking ? 'scale(1 0.05)' : '');
  }
  if (!blinking && blinkUntil && hostT >= blinkUntil){
    blinkUntil = 0;
    nextBlink = hostT + 2 + Math.random() * 3.5;
  }

  // wave on new scene
  const waving = hostT < waveUntil;
  if (waving){
    const p = (waveUntil - hostT);
    const a = Math.sin(hostT * 9) * 18;
    armRight.setAttribute('transform', `rotate(${-25 - a} 142 210)`);
  } else {
    armRight.setAttribute('transform', '');
  }

  // subtle idle arm sway
  armLeft.setAttribute('transform', `rotate(${Math.sin(hostT * 1.2) * 2.4} 58 210)`);
}

function hostSay(text, ms = 4500){
  bubbleText.textContent = text;
  bubble.classList.add('show');
  waveUntil = hostT + 1.1;
  // subtle "speaking" mouth oscillation
  let t0 = performance.now();
  const talk = setInterval(() => {
    const t = (performance.now() - t0) / 1000;
    const open = 1 + Math.sin(t * 14) * 0.6;
    mouth.setAttribute('d', `M90 142 Q 100 ${144 + open * 3} 110 142`);
    if (performance.now() - t0 > ms - 400){
      clearInterval(talk);
      mouth.setAttribute('d', 'M90 142 Q 100 150 110 142');
    }
  }, 45);
  clearTimeout(hostSay._t);
  hostSay._t = setTimeout(() => bubble.classList.remove('show'), ms);
}

function hostLineFor(scene, prompt){
  const lines = {
    waterfall: ["Mind the spray.", "Listen — that's the canyon talking.", "Welcome to the falls."],
    rain:      ["Grab an umbrella.", "Neon looks better wet.", "Rain check? No, rain now."],
    snow:      ["Bundle up.", "First snow of the set.", "Winter, on cue."],
    fire:      ["Stand back — it's hot tonight.", "Lava's an acquired taste.", "Warm reception, huh?"],
    forest:    ["After you.", "Watch your step — roots.", "The canopy's quiet today."],
    cosmic:    ["Welcome to the upstairs.", "Mind the stardust.", "You brought your own gravity, right?"],
    city:      ["Streets are alive.", "Best ramen's around the corner.", "Neon — the original vibe check."],
    ocean:     ["Tide's in.", "Smell that salt?", "Low and slow today."],
    desert:    ["Dry heat, they say.", "Hydrate. Then dream.", "Sand, wind, story."],
  };
  const arr = lines[scene.type] || ["Stage set. Enjoy the show."];
  return arr[Math.floor(Math.random() * arr.length)];
}

hostToggle.addEventListener('click', () => {
  const off = hostEl.classList.toggle('hidden');
  hostToggle.classList.toggle('off', off);
});

// Boot: start the renderer immediately with the initial scene,
// then trigger an initial generation so the page "arrives" alive.
resize();
systems = buildSystems(scene);
applyGrade(scene);
requestAnimationFrame((t) => { last = t; frame(t); });

// Kick off the first generation so the base plate arrives shortly
generate(input.value.trim() || 'A waterfall at sunset in a jungle canyon, mist, golden light');

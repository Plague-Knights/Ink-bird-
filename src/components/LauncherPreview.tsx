"use client";

// Static visual preview of the cannon-style launcher: one input (FIRE),
// server rolls the outcome, distance-based multiplier. Side-scroller
// feel — long seascape, squid flies across, lands on open sand or
// hits a rock. Mid-air is always safe; only the landing surface
// determines win/bust. Uses the pipes-game ocean atmosphere.

import { useEffect, useRef } from "react";
import { GROUND_H, type Bird } from "@/lib/simulate";
import { drawBird } from "@/lib/gameArt";

const PREVIEW_W = 1800;
const PREVIEW_H = 560;

type Bubble = { x: number; y: number; r: number; tw: number };
type Weed = { x: number; w: number; h: number; layer: 0 | 1 };
type Rock = { x: number; w: number; h: number };

export function LauncherPreview() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext("2d"); if (!ctx) return;

    const bubbles: Bubble[] = [];
    for (let i = 0; i < 90; i++) {
      bubbles.push({
        x: (i * 97) % PREVIEW_W,
        y: 30 + ((i * 173) % (PREVIEW_H - GROUND_H - 60)),
        r: 1.2 + ((i * 7) % 20) / 10,
        tw: i,
      });
    }
    const weeds: Weed[] = [];
    for (let i = 0; i < 12; i++) weeds.push({ layer: 0, x: i * 170 + 30, w: 150, h: 80 });
    for (let i = 0; i < 12; i++) weeds.push({ layer: 1, x: i * 200 + 80, w: 180, h: 120 });

    // Procedural rocks + reefs — different every mount so the seabed
    // feels alive instead of identical-every-load. Seeded so a single
    // mount renders consistent across frames, but each reload = new
    // layout. When we wire this into the real game, the seed will come
    // from the round commit so the layout is provably tied to the roll.
    const seed = (Date.now() & 0xffff) | 1;
    const rocks = generateRocks(seed);
    const reefs = generateReefs(seed * 7919);
    const creatures = generateCreatures(seed * 31337);
    const midAirFish = generateMidAirFish(seed * 11117);

    let raf = 0;
    let frame = 0;
    const tick = () => {
      frame++;
      render(ctx, bubbles, weeds, rocks, reefs, creatures, midAirFish, frame);
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={PREVIEW_W}
      height={PREVIEW_H}
      style={{
        width: "100%",
        height: "auto",
        aspectRatio: `${PREVIEW_W} / ${PREVIEW_H}`,
        background: "#021830",
        border: "1px solid rgba(120, 200, 255, 0.18)",
        borderRadius: 14,
        display: "block",
      }}
    />
  );
}

// Distance markers along the sand — just the numbers, no multiplier
// chips floating overhead. The server-rolled landing point is what
// matters; the markers are purely for "how far did I go" readability.
const DISTANCE_MARKERS = [
  { distance:  "10m", frac: 0.05 },
  { distance:  "40m", frac: 0.14 },
  { distance:  "80m", frac: 0.26 },
  { distance: "120m", frac: 0.38 },
  { distance: "160m", frac: 0.50 },
  { distance: "200m", frac: 0.62 },
  { distance: "240m", frac: 0.74 },
  { distance: "300m", frac: 0.87 },
  { distance: "400m", frac: 0.97 },
];

// Payout reference legend at the top of the scene — shows the
// distance → multiplier curve so the player knows where the money is
// without needing labels plastered across every rock/reef on the
// seabed. The landing point is the only place a multiplier shows up
// in the play area; this top bar is the reference key.
const PAYOUT_LEGEND = [
  { mult: "0×",    distance: "< 10m",  color: "#ff5a5a" },
  { mult: "0.7×",  distance: "< 40m",  color: "#ff9b5a" },
  { mult: "0.9×",  distance: "< 80m",  color: "#ffb464" },
  { mult: "1.05×", distance: "< 120m", color: "#cfe7ff" },
  { mult: "1.2×",  distance: "< 200m", color: "#cfd8dc" },
  { mult: "1.8×",  distance: "< 280m", color: "#ffd76a" },
  { mult: "5×",    distance: "300m+",  color: "#7fe3ff" },
];

type ReefCoral = { x: number; h: number; color: string; sway: number };
type Reef = { x: number; wBase: number; corals: ReefCoral[] };
type Creature = { x: number; kind: "fish" | "squid"; color: string; size: number; flip: boolean };
type MidAirFish = { x: number; y: number; color: string; size: number; phase: number; flip: boolean };

// Snapshot trajectory — includes a bounce off a rock mid-flight.
// First arc = muzzle → bounce point. Second arc = bounce → landing.
// BIRD_FRAC is along the SECOND arc for the screenshot moment.
const BOUNCE_FRAC = 0.36;      // where squid first hits the seabed
const LAND_FRAC   = 0.68;      // final landing spot after the bounce
const BIRD_FRAC   = 0.45;      // squid position along the 2nd arc (post-bounce)
const LAND_MULT = 1.2;
const LAND_DISTANCE = "260m";

// Mulberry32 PRNG — same generator used in simulate.ts. Gives us a
// deterministic stream of "random" numbers from a single seed.
function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function generateRocks(seed: number): Rock[] {
  const rand = mulberry32(seed);
  const rocks: Rock[] = [];
  // 9–14 rocks scattered across the strip with clustering bias
  const count = 9 + Math.floor(rand() * 6);
  for (let i = 0; i < count; i++) {
    // Cluster around seed-chosen hotspots so rocks group naturally
    // instead of being evenly spaced. Each rock picks a base band then
    // jitters within it.
    const band = rand();
    rocks.push({
      x: Math.min(0.98, Math.max(0.04, band + (rand() - 0.5) * 0.05)),
      w: 18 + rand() * 32,
      h: 9 + rand() * 18,
    });
  }
  return rocks.sort((a, b) => a.x - b.x);
}

function generateReefs(seed: number): Reef[] {
  const rand = mulberry32(seed);
  const reefs: Reef[] = [];
  // 3–5 reef structures — taller, more colorful, with coral branches
  const count = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < count; i++) {
    const corals: ReefCoral[] = [];
    const coralCount = 4 + Math.floor(rand() * 5);
    for (let j = 0; j < coralCount; j++) {
      corals.push({
        x: (rand() - 0.5) * 60,
        h: 20 + rand() * 40,
        color: rand() < 0.5
          ? "#ff7aa8"
          : rand() < 0.5 ? "#ff9b5a" : "#c88afe",
        sway: rand() * Math.PI * 2,
      });
    }
    reefs.push({
      x: 0.15 + rand() * 0.8,
      wBase: 50 + rand() * 40,
      corals,
    });
  }
  return reefs.sort((a, b) => a.x - b.x);
}

function generateCreatures(seed: number): Creature[] {
  const rand = mulberry32(seed);
  const creatures: Creature[] = [];
  const count = 4 + Math.floor(rand() * 3);
  for (let i = 0; i < count; i++) {
    const isSquid = rand() < 0.4;
    creatures.push({
      x: 0.1 + rand() * 0.85,
      kind: isSquid ? "squid" : "fish",
      color: rand() < 0.5 ? "#ff7aa8" : rand() < 0.5 ? "#ffb464" : "#7fe3ff",
      size: 0.8 + rand() * 0.5,
      flip: rand() < 0.5,
    });
  }
  return creatures.sort((a, b) => a.x - b.x);
}

function generateMidAirFish(seed: number): MidAirFish[] {
  const rand = mulberry32(seed);
  const fish: MidAirFish[] = [];
  const count = 5 + Math.floor(rand() * 4);
  for (let i = 0; i < count; i++) {
    fish.push({
      x: 0.15 + rand() * 0.8,
      y: 0.25 + rand() * 0.45, // fraction of mid-air height
      color: rand() < 0.5 ? "#ff9b5a" : "#7fe3ff",
      size: 0.7 + rand() * 0.4,
      phase: rand() * Math.PI * 2,
      flip: rand() < 0.5,
    });
  }
  return fish;
}

function render(
  ctx: CanvasRenderingContext2D,
  bubbles: Bubble[],
  weeds: Weed[],
  rocks: Rock[],
  reefs: Reef[],
  creatures: Creature[],
  midAirFish: MidAirFish[],
  frame: number,
) {
  const W2 = PREVIEW_W, H2 = PREVIEW_H;
  ctx.clearRect(0, 0, W2, H2);

  // ── Pipes-game ocean gradient ──
  const sky = ctx.createLinearGradient(0, 0, 0, H2 - GROUND_H);
  sky.addColorStop(0, "#7ad3e0");
  sky.addColorStop(0.25, "#2a9ac2");
  sky.addColorStop(0.6, "#0e4a7c");
  sky.addColorStop(1, "#041a3a");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W2, H2 - GROUND_H);

  // Surface shimmer
  const shimmer = ctx.createLinearGradient(0, 0, 0, 40);
  shimmer.addColorStop(0, "rgba(255,255,255,0.35)");
  shimmer.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = shimmer;
  ctx.fillRect(0, 0, W2, 40);

  // Light shafts
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 14; i++) {
    const baseX = ((i * 180 + frame * 0.4) % (W2 + 240)) - 120;
    ctx.fillStyle = "rgba(200, 230, 255, 0.05)";
    ctx.beginPath();
    ctx.moveTo(baseX, 0);
    ctx.lineTo(baseX + 50, 0);
    ctx.lineTo(baseX + 260, H2 - GROUND_H);
    ctx.lineTo(baseX + 210, H2 - GROUND_H);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // Bubbles
  for (const b of bubbles) {
    const a = 0.35 + Math.sin(b.tw + frame * 0.03) * 0.15;
    ctx.strokeStyle = `rgba(220,240,255,${a + 0.35})`;
    ctx.lineWidth = 1;
    ctx.fillStyle = `rgba(180,220,255,${a * 0.35})`;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // Kelp
  const baseY = H2 - GROUND_H;
  for (const h of weeds) {
    const isFar = h.layer === 0;
    ctx.strokeStyle = isFar ? "rgba(25,90,80,0.55)" : "rgba(10,60,45,0.95)";
    ctx.lineWidth = isFar ? 3 : 5;
    ctx.lineCap = "round";
    const blades = isFar ? 3 : 4;
    for (let i = 0; i < blades; i++) {
      const bx = h.x + (i + 0.5) * (h.w / blades);
      const bladeH = h.h * 0.85;
      ctx.beginPath();
      ctx.moveTo(bx, baseY);
      for (let st = 1; st <= 5; st++) {
        const t = st / 5;
        const wy = baseY - t * bladeH;
        const wx = bx + Math.sin(frame * 0.04 + i * 0.9 + h.x * 0.02 + t * 2) * 7 * t;
        ctx.lineTo(wx, wy);
      }
      ctx.stroke();
    }
  }

  // Ground
  const ground = ctx.createLinearGradient(0, H2 - GROUND_H, 0, H2);
  ground.addColorStop(0, "#d5b47c");
  ground.addColorStop(1, "#6f4c22");
  ctx.fillStyle = ground;
  ctx.fillRect(0, H2 - GROUND_H, W2, GROUND_H);
  ctx.fillStyle = "rgba(40,25,8,0.4)";
  ctx.fillRect(0, H2 - GROUND_H, W2, 2);

  // ── Scatter rocks + reefs on the seabed (procedural per mount) ──
  const stripStart = 150;
  const stripEnd = W2 - 40;
  const stripW = stripEnd - stripStart;
  const sandLevel = H2 - GROUND_H + 4;

  // Reefs first (they're taller and sit behind rocks visually)
  for (const reef of reefs) {
    const rx = stripStart + stripW * reef.x;
    drawReef(ctx, rx, sandLevel, reef, frame);
  }

  for (const r of rocks) {
    const rx = stripStart + stripW * r.x;
    drawRock(ctx, rx, sandLevel, r.w, r.h, r.x);
  }

  // Bottom creatures (fish + small squids) — these are BOUNCE hazards,
  // not bust hazards. Landing on one can send the squid further OR
  // kill it on impact. Rocks = always bust, creatures = always bounce.
  for (const c of creatures) {
    const cx = stripStart + stripW * c.x;
    drawBottomCreature(ctx, cx, sandLevel - 6, c, frame);
  }

  // Mid-air swimming fish — the squid can glance off these in flight
  // and get carried further. Pure good-luck bounces.
  for (const f of midAirFish) {
    const fx = stripStart + stripW * f.x + Math.sin(frame * 0.02 + f.phase) * 20;
    const fy = 60 + (H2 - GROUND_H - 120) * f.y + Math.sin(frame * 0.03 + f.phase) * 8;
    drawMidAirFish(ctx, fx, fy, f, frame);
  }

  // Faint distance ticks on the sand — no chips, just tiny labels so
  // the player has a sense of scale without the HUD shouting at them.
  ctx.textAlign = "center";
  DISTANCE_MARKERS.forEach(m => {
    const mx = stripStart + stripW * m.frac;
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mx, sandLevel + 1);
    ctx.lineTo(mx, sandLevel + 5);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = '9px ui-monospace, monospace';
    ctx.fillText(m.distance, mx, sandLevel + 16);
  });
  ctx.textAlign = "start";

  // ── DETAILED CANNON (left side) ──
  const cannonBaseX = 92;
  const cannonBaseY = H2 - GROUND_H;
  drawDetailedCannon(ctx, cannonBaseX, cannonBaseY, frame);

  drawCoiledRope(ctx, cannonBaseX + 68, cannonBaseY - 6);
  drawCannonballs(ctx, cannonBaseX - 46, cannonBaseY - 6);

  // ── Landing point — glowing circle on sand where squid will land ──
  const muzzleX = cannonBaseX + 62;
  const muzzleY = cannonBaseY - 58;
  const landX = stripStart + stripW * LAND_FRAC;
  const landY = sandLevel - 2;

  // Landing glow — gold for a win zone
  const landingGlow = ctx.createRadialGradient(landX, landY, 2, landX, landY, 40);
  landingGlow.addColorStop(0, "rgba(255, 215, 106, 0.65)");
  landingGlow.addColorStop(1, "rgba(255, 215, 106, 0)");
  ctx.fillStyle = landingGlow;
  ctx.beginPath();
  ctx.ellipse(landX, landY, 40, 10, 0, 0, Math.PI * 2);
  ctx.fill();

  // Simple multiplier badge at the landing point — just the number.
  const chipW = 58, chipH = 28;
  const chipY = landY - 90;
  ctx.shadowColor = "rgba(255,215,106,0.6)";
  ctx.shadowBlur = 14;
  ctx.fillStyle = "rgba(255, 215, 106, 0.95)";
  roundRect(ctx, landX - chipW / 2, chipY, chipW, chipH, 8);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#1a0a00";
  ctx.font = 'bold 16px "Rubik", sans-serif';
  ctx.textAlign = "center";
  ctx.fillText(LAND_MULT + "×", landX, chipY + 19);
  ctx.textAlign = "start";

  // Thin guide dot line down to landing
  ctx.strokeStyle = "rgba(255,215,106,0.35)";
  ctx.lineWidth = 1.2;
  ctx.setLineDash([2, 4]);
  ctx.beginPath();
  ctx.moveTo(landX, chipY + chipH + 4);
  ctx.lineTo(landX, landY - 6);
  ctx.stroke();
  ctx.setLineDash([]);

  // ── TRAJECTORY: two arcs joined at the bounce point ──
  // Arc A: muzzle → bounce (full-height apex, full energy)
  // Arc B: bounce → landing  (lower apex, reduced energy post-bounce)
  const bounceX = stripStart + stripW * BOUNCE_FRAC;
  const bounceY = sandLevel - 4;

  // Arc A control point
  const aMidX = (muzzleX + bounceX) / 2;
  const aApex = Math.min(muzzleY, bounceY) - 200;
  // Arc B control point — lower apex (post-bounce energy loss)
  const bMidX = (bounceX + landX) / 2;
  const bApex = Math.min(bounceY, landY) - 110;

  function arcPos(t: number, x0: number, y0: number, mx: number, ma: number, x1: number, y1: number) {
    const x = (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * mx + t * t * x1;
    const y = (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * ma + t * t * y1;
    return { x, y };
  }
  function arcSlope(t: number, x0: number, y0: number, mx: number, ma: number, x1: number, y1: number) {
    const dx = 2 * (1 - t) * (mx - x0) + 2 * t * (x1 - mx);
    const dy = 2 * (1 - t) * (ma - y0) + 2 * t * (y1 - ma);
    return Math.atan2(dy, dx);
  }

  // Dotted preview of arc A (pre-bounce, dimmed since it already happened)
  ctx.save();
  ctx.setLineDash([4, 6]);
  ctx.strokeStyle = "rgba(127,227,255,0.22)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let t = 0; t <= 1; t += 0.02) {
    const p = arcPos(t, muzzleX, muzzleY, aMidX, aApex, bounceX, bounceY);
    if (t === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  // Arc B — the post-bounce flight, brighter since that's the active one
  ctx.strokeStyle = "rgba(127,227,255,0.5)";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (let t = 0; t <= 1; t += 0.02) {
    const p = arcPos(t, bounceX, bounceY, bMidX, bApex, landX, landY);
    if (t === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  ctx.restore();

  // ── Bounce impact — a startled fish at the seabed kicks the squid up ──
  // No labels — the visual (fish + shockwave + split arc) tells it.
  ctx.save();
  drawBottomCreature(ctx, bounceX, bounceY - 4, {
    x: 0, kind: "fish", color: "#ffd76a", size: 1.4, flip: true,
  }, frame);
  const shockR = 24 + Math.sin(frame * 0.2) * 2;
  ctx.strokeStyle = "rgba(255, 180, 80, 0.7)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(bounceX, bounceY, shockR, 5, 0, 0, Math.PI * 2);
  ctx.stroke();
  // Subtle concentric wave
  ctx.strokeStyle = "rgba(255, 180, 80, 0.3)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(bounceX, bounceY, shockR + 8, 8, 0, 0, Math.PI * 2);
  ctx.stroke();
  // Sand/debris puffs
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI - Math.PI;
    const d = 16 + (i % 3) * 4;
    const px = bounceX + Math.cos(ang) * d;
    const py = bounceY - 4 + Math.abs(Math.sin(ang)) * -6;
    ctx.fillStyle = i % 2 === 0 ? "rgba(213, 180, 124, 0.7)" : "rgba(90, 60, 30, 0.55)";
    ctx.beginPath();
    ctx.arc(px, py, 1.8 - (i % 2) * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // ── Squid mid-flight along arc B ──
  const t = BIRD_FRAC;
  const p = arcPos(t, bounceX, bounceY, bMidX, bApex, landX, landY);
  const bird: Bird = { x: p.x, y: p.y, vy: 0, r: 18 };
  const slope = arcSlope(t, bounceX, bounceY, bMidX, bApex, landX, landY);
  drawBird(ctx, bird, slope * 1.5, frame * 0.6, frame);

  // Motion trail behind squid (along arc B)
  for (let i = 1; i <= 6; i++) {
    const tt = Math.max(0, t - i * 0.025);
    const tp = arcPos(tt, bounceX, bounceY, bMidX, bApex, landX, landY);
    ctx.fillStyle = `rgba(127, 227, 255, ${0.25 - i * 0.035})`;
    ctx.beginPath();
    ctx.arc(tp.x, tp.y, 6 - i * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── HUD: FIRE button, BET, DISTANCE readout ──
  const fireX = 24, fireY = 24, fireW = 180, fireH = 64;
  const fireBg = ctx.createLinearGradient(fireX, fireY, fireX, fireY + fireH);
  fireBg.addColorStop(0, "#ffd76a");
  fireBg.addColorStop(1, "#e0a020");
  ctx.fillStyle = fireBg;
  roundRect(ctx, fireX, fireY, fireW, fireH, 12);
  ctx.fill();
  ctx.fillStyle = "#1a0a00";
  ctx.font = 'bold 22px "Rubik", sans-serif';
  ctx.textAlign = "center";
  ctx.fillText("FIRE", fireX + fireW / 2, fireY + 34);
  ctx.fillStyle = "rgba(26,10,0,0.7)";
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillText("one input · one result", fireX + fireW / 2, fireY + 54);

  const betX = W2 - 200, betY = 24, betW = 176, betH = 64;
  ctx.fillStyle = "rgba(2,24,48,0.78)";
  roundRect(ctx, betX, betY, betW, betH, 10); ctx.fill();
  ctx.strokeStyle = "rgba(127,227,255,0.35)";
  ctx.lineWidth = 1;
  roundRect(ctx, betX, betY, betW, betH, 10); ctx.stroke();
  ctx.fillStyle = "#7b94b8";
  ctx.font = '10px ui-monospace, monospace';
  ctx.textAlign = "left";
  ctx.fillText("BET", betX + 14, betY + 20);
  ctx.fillStyle = "#cfe7ff";
  ctx.font = 'bold 22px "Rubik", sans-serif';
  ctx.fillText("0.0100", betX + 14, betY + 48);
  ctx.fillStyle = "#7b94b8";
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillText("ETH", betX + 116, betY + 48);

  // No center readout — the landing chip + payout legend tell the story.

  // Vignette
  const vig = ctx.createRadialGradient(W2 / 2, H2 / 2, H2 * 0.45, W2 / 2, H2 / 2, H2 * 0.9);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,0.4)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W2, H2);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/// Rough jagged rock silhouette on the seabed. `seed` randomizes the
/// shape so every rock looks different without needing per-rock art.
function drawRock(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seed: number) {
  // Bumpy outline — 7 points around the top half, seed-perturbed
  const top = y - h;
  const points: [number, number][] = [];
  const bumps = 7;
  for (let i = 0; i <= bumps; i++) {
    const t = i / bumps;
    const px = x - w / 2 + t * w;
    const roughness = Math.sin((seed + i) * 91.7) * 0.5 + 0.5;
    const py = top + (Math.sin(i * 1.7 + seed * 17) * 0.25 + 0.15) * h * roughness;
    points.push([px, py]);
  }

  // Drop shadow on sand
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.ellipse(x, y + 2, w * 0.55, 3, 0, 0, Math.PI * 2);
  ctx.fill();

  // Rock body — dark grey/green-blue mossy stone
  const rockGrad = ctx.createLinearGradient(0, top, 0, y);
  rockGrad.addColorStop(0, "#4a4a52");
  rockGrad.addColorStop(0.5, "#2a2a32");
  rockGrad.addColorStop(1, "#181820");
  ctx.fillStyle = rockGrad;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y);
  for (const [px, py] of points) ctx.lineTo(px, py);
  ctx.lineTo(x + w / 2, y);
  ctx.closePath();
  ctx.fill();

  // Mossy/algae highlight on top of rock
  ctx.fillStyle = "rgba(60, 120, 90, 0.55)";
  ctx.beginPath();
  ctx.moveTo(points[0]![0], points[0]![1]);
  for (const [px, py] of points) ctx.lineTo(px, py - 0.5);
  // back across just above the outline
  for (let i = points.length - 1; i >= 0; i--) {
    const [px, py] = points[i]!;
    ctx.lineTo(px, py + 2.2);
  }
  ctx.closePath();
  ctx.fill();

  // Highlight specks
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  for (let i = 0; i < 3; i++) {
    const sx = x - w / 3 + (i * w) / 4;
    const sy = top + h * 0.25 + Math.sin(seed * 11 + i) * 3;
    ctx.beginPath();
    ctx.arc(sx, sy, 1.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Subtle red glow hint so rocks read as "danger" without being obnoxious
  const glow = ctx.createRadialGradient(x, top + 2, 0, x, top + 2, w * 0.7);
  glow.addColorStop(0, "rgba(255, 80, 80, 0.12)");
  glow.addColorStop(1, "rgba(255, 80, 80, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, top + 2, w * 0.7, 0, Math.PI * 2);
  ctx.fill();
}

/// Detailed pirate-style cannon: tapered barrel, three brass bands with
/// iron rivets, trunnions, dolphin handles, muzzle flash smoke, wheeled
/// carriage with plank detail and spoked wheels. Anchored on the sand.
function drawDetailedCannon(ctx: CanvasRenderingContext2D, baseX: number, baseY: number, frame: number) {
  const angle = -0.55; // ~32° up

  const carX = baseX - 18, carY = baseY - 26;
  const carW = 64, carH = 22;

  // Carriage shadow on sand
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.ellipse(baseX + 10, baseY + 2, 62, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  const woodGrad = ctx.createLinearGradient(0, carY, 0, carY + carH);
  woodGrad.addColorStop(0, "#8b5a2b");
  woodGrad.addColorStop(0.6, "#5a3816");
  woodGrad.addColorStop(1, "#2e1a08");
  ctx.fillStyle = woodGrad;
  ctx.beginPath();
  ctx.moveTo(carX, carY + 4);
  ctx.lineTo(carX + carW, carY);
  ctx.lineTo(carX + carW, carY + carH);
  ctx.lineTo(carX, carY + carH);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(20,10,0,0.55)";
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const px = carX + (carW / 4) * i;
    ctx.beginPath();
    ctx.moveTo(px, carY + (1 - i / 4) * 4);
    ctx.lineTo(px, carY + carH);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(40,20,5,0.35)";
  for (let g = 0; g < 5; g++) {
    ctx.beginPath();
    ctx.moveTo(carX + 2, carY + 6 + g * 3);
    ctx.quadraticCurveTo(carX + carW / 2, carY + 6 + g * 3 + (g % 2 ? -1 : 1) * 1.5, carX + carW - 2, carY + 6 + g * 3);
    ctx.stroke();
  }

  ctx.fillStyle = "#1a1410";
  for (const [bx, by] of [[carX + 6, carY + 8], [carX + carW - 6, carY + 6], [carX + 6, carY + carH - 5], [carX + carW - 6, carY + carH - 5]]) {
    ctx.beginPath();
    ctx.arc(bx!, by!, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // Barrel
  ctx.save();
  ctx.translate(baseX, baseY - 20);
  ctx.rotate(angle);

  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.moveTo(-6, 10);
  ctx.lineTo(78, 12);
  ctx.lineTo(78, 14);
  ctx.lineTo(-6, 14);
  ctx.closePath();
  ctx.fill();

  const barrelGrad = ctx.createLinearGradient(0, -16, 0, 16);
  barrelGrad.addColorStop(0, "#5a5048");
  barrelGrad.addColorStop(0.35, "#2a2218");
  barrelGrad.addColorStop(0.55, "#1a140c");
  barrelGrad.addColorStop(1, "#0a0804");
  ctx.fillStyle = barrelGrad;
  ctx.beginPath();
  ctx.moveTo(-12, -10);
  ctx.lineTo(68, -14);
  ctx.lineTo(72, -16);
  ctx.lineTo(72, 16);
  ctx.lineTo(68, 14);
  ctx.lineTo(-12, 10);
  ctx.lineTo(-18, 6);
  ctx.lineTo(-20, 0);
  ctx.lineTo(-18, -6);
  ctx.closePath();
  ctx.fill();

  const hiGrad = ctx.createLinearGradient(0, -10, 0, -4);
  hiGrad.addColorStop(0, "rgba(255,255,255,0.28)");
  hiGrad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = hiGrad;
  ctx.beginPath();
  ctx.moveTo(-12, -10); ctx.lineTo(68, -14); ctx.lineTo(68, -11); ctx.lineTo(-12, -7);
  ctx.closePath();
  ctx.fill();

  const bandPositions = [0, 26, 58];
  for (const bx of bandPositions) {
    const tb = (bx + 20) / 92;
    const bandH = 10 + (1 - tb) * 4;
    const brass = ctx.createLinearGradient(0, -bandH, 0, bandH);
    brass.addColorStop(0, "#f4d48a");
    brass.addColorStop(0.5, "#c28e4a");
    brass.addColorStop(1, "#6a4820");
    ctx.fillStyle = brass;
    ctx.fillRect(bx - 2, -bandH - 1, 5, bandH * 2 + 2);
    ctx.fillStyle = "#1a1008";
    ctx.beginPath();
    ctx.arc(bx + 0.5, -bandH + 2, 1.1, 0, Math.PI * 2);
    ctx.arc(bx + 0.5, bandH - 2, 1.1, 0, Math.PI * 2);
    ctx.fill();
  }

  const lipGrad = ctx.createLinearGradient(0, -16, 0, 16);
  lipGrad.addColorStop(0, "#f4d48a");
  lipGrad.addColorStop(0.5, "#c28e4a");
  lipGrad.addColorStop(1, "#6a4820");
  ctx.fillStyle = lipGrad;
  ctx.fillRect(68, -16, 4, 32);
  ctx.fillStyle = "#050302";
  ctx.beginPath();
  ctx.ellipse(71, 0, 2, 10, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#2a2218";
  ctx.beginPath();
  ctx.arc(14, 14, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#8a7850";
  ctx.beginPath();
  ctx.arc(14, 14, 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#c28e4a";
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(22, -10);
  ctx.quadraticCurveTo(28, -18, 34, -10);
  ctx.stroke();

  const casc = ctx.createRadialGradient(-19, 0, 1, -19, 0, 6);
  casc.addColorStop(0, "#5a5048");
  casc.addColorStop(1, "#0a0804");
  ctx.fillStyle = casc;
  ctx.beginPath();
  ctx.arc(-19, 0, 5, 0, Math.PI * 2);
  ctx.fill();

  for (let i = 0; i < 4; i++) {
    const sf = frame * 0.12 + i;
    const sx = 82 + i * 6 + Math.sin(sf) * 1.5;
    const sy = -2 + Math.cos(sf * 0.7) * 2 - i * 2;
    const sr = 10 - i * 1.2 + Math.sin(sf) * 1;
    const sa = 0.5 - i * 0.1;
    ctx.fillStyle = `rgba(240, 240, 250, ${sa})`;
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, Math.PI * 2);
    ctx.fill();
  }

  const flash = ctx.createRadialGradient(74, 0, 1, 74, 0, 18);
  flash.addColorStop(0, "rgba(255, 220, 140, 0.8)");
  flash.addColorStop(0.4, "rgba(255, 160, 60, 0.4)");
  flash.addColorStop(1, "rgba(255, 80, 20, 0)");
  ctx.fillStyle = flash;
  ctx.beginPath();
  ctx.arc(74, 0, 18, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  // Wheels
  for (const wx of [baseX - 10, baseX + 22]) {
    ctx.fillStyle = "#1a140a";
    ctx.beginPath();
    ctx.arc(wx, baseY - 6, 14, 0, Math.PI * 2);
    ctx.fill();
    const wheelGrad = ctx.createRadialGradient(wx, baseY - 6, 2, wx, baseY - 6, 12);
    wheelGrad.addColorStop(0, "#8b5a2b");
    wheelGrad.addColorStop(1, "#3a2310");
    ctx.fillStyle = wheelGrad;
    ctx.beginPath();
    ctx.arc(wx, baseY - 6, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#2a1a08";
    ctx.lineWidth = 2;
    for (let s = 0; s < 6; s++) {
      const a = (s / 6) * Math.PI * 2 + frame * 0.003;
      ctx.beginPath();
      ctx.moveTo(wx, baseY - 6);
      ctx.lineTo(wx + Math.cos(a) * 12, baseY - 6 + Math.sin(a) * 12);
      ctx.stroke();
    }
    ctx.fillStyle = "#c28e4a";
    ctx.beginPath();
    ctx.arc(wx, baseY - 6, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1a1008";
    ctx.beginPath();
    ctx.arc(wx, baseY - 6, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCannonballs(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  const r = 4.5;
  const positions = [
    [-2 * r, 0, 0], [0, 0, 0], [2 * r, 0, 0],
    [-r, -r * 1.6, 1], [r, -r * 1.6, 1],
    [0, -r * 3.2, 2],
  ] as const;
  for (const [dx, dy, row] of positions) {
    const bx = cx + dx, by = cy + dy;
    const grad = ctx.createRadialGradient(bx - 1, by - 1, 0.5, bx, by, r);
    grad.addColorStop(0, "#4a4a4a");
    grad.addColorStop(0.7, "#1a1a1a");
    grad.addColorStop(1, "#050505");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(255,255,255,${0.15 + row * 0.05})`;
    ctx.beginPath();
    ctx.arc(bx - 1.2, by - 1.2, 1, 0, Math.PI * 2);
    ctx.fill();
  }
}

/// Coral reef cluster — a base mound with colored coral branches.
/// Decorative (reefs aren't bust zones on their own; rocks adjacent to
/// the reef do the busting). Gives the seabed depth and variety.
function drawReef(ctx: CanvasRenderingContext2D, cx: number, baseY: number, reef: Reef, frame: number) {
  // Base mound — rounded bump
  const moundH = 14;
  const moundGrad = ctx.createLinearGradient(0, baseY - moundH, 0, baseY);
  moundGrad.addColorStop(0, "#7a5a38");
  moundGrad.addColorStop(1, "#3a2410");
  ctx.fillStyle = moundGrad;
  ctx.beginPath();
  ctx.moveTo(cx - reef.wBase / 2, baseY);
  ctx.quadraticCurveTo(cx - reef.wBase / 3, baseY - moundH, cx, baseY - moundH);
  ctx.quadraticCurveTo(cx + reef.wBase / 3, baseY - moundH, cx + reef.wBase / 2, baseY);
  ctx.closePath();
  ctx.fill();

  // Coral branches sprouting from the mound
  for (const coral of reef.corals) {
    const kx = cx + coral.x;
    const sway = Math.sin(frame * 0.03 + coral.sway) * 3;
    // Main stem
    ctx.strokeStyle = coral.color;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(kx, baseY - 2);
    ctx.quadraticCurveTo(kx + sway * 0.5, baseY - coral.h / 2, kx + sway, baseY - coral.h);
    ctx.stroke();
    // Side branches
    for (let i = 0; i < 3; i++) {
      const t = 0.35 + i * 0.2;
      const by = baseY - coral.h * t;
      const bxs = kx + sway * t * 0.5;
      const dir = i % 2 === 0 ? 1 : -1;
      ctx.beginPath();
      ctx.moveTo(bxs, by);
      ctx.quadraticCurveTo(bxs + dir * 4, by - 2, bxs + dir * 8, by - coral.h * 0.15);
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    // Glow tip
    const tipGlow = ctx.createRadialGradient(kx + sway, baseY - coral.h, 0, kx + sway, baseY - coral.h, 8);
    tipGlow.addColorStop(0, coral.color + "88");
    tipGlow.addColorStop(1, coral.color + "00");
    ctx.fillStyle = tipGlow;
    ctx.beginPath();
    ctx.arc(kx + sway, baseY - coral.h, 8, 0, Math.PI * 2);
    ctx.fill();
    // Bud at tip
    ctx.fillStyle = coral.color;
    ctx.beginPath();
    ctx.arc(kx + sway, baseY - coral.h, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

/// Little fish or squid resting/swimming near the seabed — landing on
/// one causes a bounce (squid can go further OR die on impact).
function drawBottomCreature(ctx: CanvasRenderingContext2D, cx: number, cy: number, c: Creature, frame: number) {
  if (c.kind === "fish") {
    drawFishSprite(ctx, cx, cy, c.color, c.size, c.flip, frame + cx * 0.3);
  } else {
    drawSmallSquidSprite(ctx, cx, cy, c.color, c.size, frame + cx * 0.3);
  }
}

function drawMidAirFish(ctx: CanvasRenderingContext2D, cx: number, cy: number, f: MidAirFish, frame: number) {
  drawFishSprite(ctx, cx, cy, f.color, f.size, f.flip, frame + f.phase * 30);
}

/// Stylized tropical/reef fish sprite: teardrop body shape (fatter
/// head, tapering toward tail), forked tail, proper pectoral +
/// dorsal fins, stripes/spots pattern, glowing underbelly gradient,
/// expressive eye with highlight. Tail flicks subtly with frame.
function drawFishSprite(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string, size: number, flip: boolean, frame: number) {
  const L = 26 * size;
  const H2 = 11 * size;
  ctx.save();
  ctx.translate(cx, cy);
  if (flip) ctx.scale(-1, 1);

  // Drop shadow on whatever's below
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.beginPath();
  ctx.ellipse(0, H2 * 0.95, L * 0.45, 1.8, 0, 0, Math.PI * 2);
  ctx.fill();

  const tailFlick = Math.sin(frame * 0.25) * 3;

  // ── Tail fin — forked, drawn before body so body covers its root ──
  ctx.fillStyle = darken(color, 0.35);
  ctx.beginPath();
  ctx.moveTo(-L * 0.38, 0);
  ctx.quadraticCurveTo(-L * 0.55, -H2 * 0.3, -L * 0.62, -H2 * 1.1 + tailFlick);
  ctx.quadraticCurveTo(-L * 0.5, -H2 * 0.3, -L * 0.4, -H2 * 0.1);
  ctx.quadraticCurveTo(-L * 0.5, H2 * 0.3, -L * 0.62, H2 * 1.1 - tailFlick);
  ctx.quadraticCurveTo(-L * 0.55, H2 * 0.3, -L * 0.38, 0);
  ctx.closePath();
  ctx.fill();
  // Tail fin stripes
  ctx.strokeStyle = darken(color, 0.5);
  ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    const t = 0.25 + i * 0.25;
    ctx.beginPath();
    ctx.moveTo(-L * 0.4, 0);
    ctx.quadraticCurveTo(-L * (0.45 + t * 0.1), -H2 * t, -L * (0.52 + t * 0.08), -H2 * (0.4 + t * 0.5) + tailFlick * 0.6);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-L * 0.4, 0);
    ctx.quadraticCurveTo(-L * (0.45 + t * 0.1), H2 * t, -L * (0.52 + t * 0.08), H2 * (0.4 + t * 0.5) - tailFlick * 0.6);
    ctx.stroke();
  }

  // ── Body — teardrop shape (fat head, tapering tail) ──
  const bodyGrad = ctx.createLinearGradient(0, -H2, 0, H2);
  bodyGrad.addColorStop(0, lighten(color, 0.35));
  bodyGrad.addColorStop(0.45, color);
  bodyGrad.addColorStop(0.85, darken(color, 0.2));
  bodyGrad.addColorStop(1, darken(color, 0.45));
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.moveTo(L * 0.5, 0);                                                      // snout
  ctx.bezierCurveTo(L * 0.5, -H2 * 0.85, L * 0.22, -H2 * 1.05, 0, -H2 * 0.95);  // top-front curve
  ctx.bezierCurveTo(-L * 0.22, -H2 * 0.9, -L * 0.38, -H2 * 0.35, -L * 0.4, 0); // top-back taper
  ctx.bezierCurveTo(-L * 0.38, H2 * 0.35, -L * 0.22, H2 * 0.9, 0, H2 * 0.95);  // bottom-back
  ctx.bezierCurveTo(L * 0.22, H2 * 1.05, L * 0.5, H2 * 0.85, L * 0.5, 0);      // bottom-front
  ctx.closePath();
  ctx.fill();

  // ── Stripes — 3 vertical stripes across the body ──
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = darken(color, 0.35);
  for (let i = 0; i < 3; i++) {
    const sx = L * 0.2 - i * L * 0.2;
    const sw = L * 0.07;
    ctx.beginPath();
    ctx.moveTo(sx - sw / 2, -H2 * 0.8);
    ctx.quadraticCurveTo(sx, -H2 * 0.9, sx + sw / 2, -H2 * 0.8);
    ctx.lineTo(sx + sw / 2, H2 * 0.8);
    ctx.quadraticCurveTo(sx, H2 * 0.9, sx - sw / 2, H2 * 0.8);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // ── Belly highlight — pale underside ──
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.beginPath();
  ctx.ellipse(L * 0.08, H2 * 0.55, L * 0.3, H2 * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();

  // ── Dorsal fin — spiky top fin ──
  ctx.fillStyle = darken(color, 0.25);
  ctx.beginPath();
  ctx.moveTo(-L * 0.1, -H2 * 0.9);
  ctx.lineTo(-L * 0.05, -H2 * 1.55);
  ctx.lineTo(L * 0.06, -H2 * 1.75);
  ctx.lineTo(L * 0.12, -H2 * 1.5);
  ctx.lineTo(L * 0.2, -H2 * 0.95);
  ctx.closePath();
  ctx.fill();
  // Dorsal spine lines
  ctx.strokeStyle = darken(color, 0.5);
  ctx.lineWidth = 0.8;
  for (let i = 0; i < 3; i++) {
    const t = 0.2 + i * 0.25;
    ctx.beginPath();
    ctx.moveTo(-L * 0.1 + t * L * 0.3, -H2 * 0.9);
    ctx.lineTo(-L * 0.05 + t * L * 0.2, -H2 * (1.3 + t * 0.3));
    ctx.stroke();
  }

  // ── Pectoral fin — the side flipper, animated flap ──
  const flap = Math.sin(frame * 0.2) * 0.15;
  ctx.save();
  ctx.translate(L * 0.05, H2 * 0.25);
  ctx.rotate(flap);
  ctx.fillStyle = darken(color, 0.15);
  ctx.beginPath();
  ctx.ellipse(0, 0, L * 0.22, H2 * 0.35, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.beginPath();
  ctx.ellipse(0, 0, L * 0.17, H2 * 0.22, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // ── Gill slit ──
  ctx.strokeStyle = darken(color, 0.45);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(L * 0.32, -H2 * 0.35);
  ctx.quadraticCurveTo(L * 0.28, 0, L * 0.32, H2 * 0.35);
  ctx.stroke();

  // ── Eye — larger, with iris + highlight ──
  const eyeX = L * 0.4, eyeY = -H2 * 0.3;
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(eyeX, eyeY, H2 * 0.3, 0, Math.PI * 2);
  ctx.fill();
  // Iris
  ctx.fillStyle = "#0a0a1a";
  ctx.beginPath();
  ctx.arc(eyeX + H2 * 0.05, eyeY + H2 * 0.02, H2 * 0.19, 0, Math.PI * 2);
  ctx.fill();
  // Pupil highlight
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(eyeX + H2 * 0.12, eyeY - H2 * 0.08, H2 * 0.08, 0, Math.PI * 2);
  ctx.fill();

  // ── Little bioluminescent glow dot on body ──
  const glowX = -L * 0.05, glowY = 0;
  const spark = ctx.createRadialGradient(glowX, glowY, 0, glowX, glowY, H2 * 0.5);
  spark.addColorStop(0, "rgba(255,255,255,0.6)");
  spark.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = spark;
  ctx.beginPath();
  ctx.arc(glowX, glowY, H2 * 0.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/// Smaller squid — simpler version of the player squid, suggests the
/// player's kin hanging out at the bottom.
function drawSmallSquidSprite(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string, size: number, frame: number) {
  const r = 8 * size;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.beginPath();
  ctx.ellipse(0, r * 0.9, r * 1.1, 1.4, 0, 0, Math.PI * 2);
  ctx.fill();
  // Arms drifting down
  ctx.strokeStyle = darken(color, 0.3);
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  for (let i = 0; i < 5; i++) {
    const t = (i - 2) / 4;
    const wave = Math.sin(frame * 0.1 + i) * 3;
    ctx.beginPath();
    ctx.moveTo(t * r * 0.8, r * 0.3);
    ctx.quadraticCurveTo(t * r * 1.1 + wave, r * 0.9, t * r * 1.3 + wave, r * 1.4);
    ctx.stroke();
  }
  // Mantle
  const mantle = ctx.createRadialGradient(0, 0, 1, 0, 0, r);
  mantle.addColorStop(0, lighten(color, 0.3));
  mantle.addColorStop(1, darken(color, 0.3));
  ctx.fillStyle = mantle;
  ctx.beginPath();
  ctx.ellipse(0, 0, r, r * 1.2, 0, 0, Math.PI * 2);
  ctx.fill();
  // Eyes
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(-r * 0.35, -r * 0.1, 2, 0, Math.PI * 2);
  ctx.arc(r * 0.35, -r * 0.1, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#0a0320";
  ctx.beginPath();
  ctx.arc(-r * 0.33, -r * 0.08, 1, 0, Math.PI * 2);
  ctx.arc(r * 0.37, -r * 0.08, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function lighten(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
}
function darken(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(r * (1 - amount), g * (1 - amount), b * (1 - amount));
}
function hexToRgb(hex: string) {
  const h = hex.replace("#", "");
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}
function rgbToHex(r: number, g: number, b: number) {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function drawCoiledRope(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  ctx.strokeStyle = "#d4b080";
  ctx.lineWidth = 2.4;
  ctx.lineCap = "round";
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(cx, cy, 5 + i * 2.5, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.strokeStyle = "#8a6030";
  ctx.lineWidth = 0.8;
  for (let i = 0; i < 3; i++) {
    const r = 5 + i * 2.5;
    for (let a = 0; a < Math.PI * 2; a += 0.7) {
      const x1 = cx + Math.cos(a) * (r - 0.8);
      const y1 = cy + Math.sin(a) * (r - 0.8);
      const x2 = cx + Math.cos(a) * (r + 0.8);
      const y2 = cy + Math.sin(a) * (r + 0.8);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  }
}

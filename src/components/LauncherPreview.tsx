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

    let raf = 0;
    let frame = 0;
    const tick = () => {
      frame++;
      render(ctx, bubbles, weeds, frame);
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

// Rocks scattered along the seabed. Each rock is a bust zone — if the
// squid lands on one, the play busts. Mid-air contact is cosmetic;
// only the final landing surface determines the outcome. The rolled
// landing distance decides whether you're on open sand or on a rock
// cluster, so the visible rocks ARE the visible house edge.
const ROCKS: Rock[] = [
  { x: 0.07, w: 40, h: 22 },   // right after cannon — classic "dud" zone
  { x: 0.20, w: 28, h: 14 },
  { x: 0.21, w: 20, h: 10 },   // cluster with the 0.20 rock
  { x: 0.33, w: 36, h: 18 },
  { x: 0.57, w: 32, h: 16 },
  { x: 0.58, w: 18, h: 8 },
  { x: 0.69, w: 46, h: 24 },   // big jagged cluster mid-distance
  { x: 0.71, w: 22, h: 12 },
  { x: 0.83, w: 28, h: 14 },
  { x: 0.92, w: 38, h: 20 },   // pre-jackpot rocks
];

// Snapshot bird position — mid-flight for dramatic screenshot. Fraction
// along the arc (0 = muzzle, 1 = landing point).
const BIRD_FRAC = 0.55;
// Where the squid will land for the snapshot (fraction of strip width).
// 0.62 = 200m marker = a "good" distance.
const LAND_FRAC = 0.62;
const LAND_MULT = 1.8;
const LAND_DISTANCE = "200m";

function render(
  ctx: CanvasRenderingContext2D,
  bubbles: Bubble[],
  weeds: Weed[],
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

  // ── Scatter rocks on the seabed — obstacles the squid can land on ──
  const stripStart = 150;
  const stripEnd = W2 - 40;
  const stripW = stripEnd - stripStart;
  const sandLevel = H2 - GROUND_H + 4;

  for (const r of ROCKS) {
    const rx = stripStart + stripW * r.x;
    drawRock(ctx, rx, sandLevel, r.w, r.h, r.x);
  }

  // ── Distance markers along the sand (the only labels) ──
  DISTANCE_MARKERS.forEach(m => {
    const mx = stripStart + stripW * m.frac;
    // Small tick on the sand
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mx, sandLevel + 2);
    ctx.lineTo(mx, sandLevel + 6);
    ctx.stroke();
    // Distance chip
    ctx.fillStyle = "rgba(40,25,8,0.75)";
    roundRect(ctx, mx - 22, sandLevel + 10, 44, 14, 3);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = 'bold 10px ui-monospace, monospace';
    ctx.textAlign = "center";
    ctx.fillText(m.distance, mx, sandLevel + 20);
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

  // Landing multiplier chip floating above
  const chipW = 92, chipH = 28;
  const chipY = landY - 120;
  ctx.fillStyle = "rgba(2,24,48,0.95)";
  roundRect(ctx, landX - chipW / 2, chipY, chipW, chipH, 8);
  ctx.fill();
  ctx.strokeStyle = "#ffd76a";
  ctx.lineWidth = 2;
  roundRect(ctx, landX - chipW / 2, chipY, chipW, chipH, 8);
  ctx.stroke();
  ctx.shadowColor = "rgba(255,215,106,0.8)";
  ctx.shadowBlur = 14;
  ctx.fillStyle = "#ffd76a";
  ctx.font = 'bold 16px "Rubik", sans-serif';
  ctx.textAlign = "center";
  ctx.fillText(LAND_MULT + "×", landX, chipY + 19);
  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(255,215,106,0.7)";
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillText(LAND_DISTANCE, landX, chipY + 30 + 10);
  ctx.textAlign = "start";

  // Thin dotted line down from chip to landing spot
  ctx.strokeStyle = "rgba(255,215,106,0.35)";
  ctx.lineWidth = 1.2;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(landX, chipY + chipH + 12);
  ctx.lineTo(landX, landY - 6);
  ctx.stroke();
  ctx.setLineDash([]);

  // ── TRAJECTORY dotted arc (mid-air is always safe) ──
  const midX = (muzzleX + landX) / 2;
  const apex = Math.min(muzzleY, landY) - 180;

  ctx.save();
  ctx.setLineDash([4, 6]);
  ctx.strokeStyle = "rgba(127,227,255,0.35)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (let t = 0; t <= 1; t += 0.02) {
    const x = (1 - t) * (1 - t) * muzzleX + 2 * (1 - t) * t * midX + t * t * landX;
    const y = (1 - t) * (1 - t) * muzzleY + 2 * (1 - t) * t * apex   + t * t * landY;
    if (t === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();

  // Squid mid-flight
  const t = BIRD_FRAC;
  const bx = (1 - t) * (1 - t) * muzzleX + 2 * (1 - t) * t * midX + t * t * landX;
  const by = (1 - t) * (1 - t) * muzzleY + 2 * (1 - t) * t * apex   + t * t * landY;
  const bird: Bird = { x: bx, y: by, vy: 0, r: 18 };
  const slope = Math.atan2(
    2 * (1 - t) * (apex - muzzleY) + 2 * t * (landY - apex),
    2 * (1 - t) * (midX - muzzleX) + 2 * t * (landX - midX),
  );
  drawBird(ctx, bird, slope * 1.5, frame * 0.6, frame);

  // Motion trail behind squid
  for (let i = 1; i <= 6; i++) {
    const tt = Math.max(0, t - i * 0.025);
    const tx = (1 - tt) * (1 - tt) * muzzleX + 2 * (1 - tt) * tt * midX + tt * tt * landX;
    const ty = (1 - tt) * (1 - tt) * muzzleY + 2 * (1 - tt) * tt * apex + tt * tt * landY;
    ctx.fillStyle = `rgba(127, 227, 255, ${0.25 - i * 0.035})`;
    ctx.beginPath();
    ctx.arc(tx, ty, 6 - i * 0.6, 0, Math.PI * 2);
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

  // Center distance readout
  const drX = W2 / 2, drY = 44;
  ctx.fillStyle = "rgba(2,24,48,0.85)";
  roundRect(ctx, drX - 140, drY - 20, 280, 44, 10); ctx.fill();
  ctx.strokeStyle = "rgba(127,227,255,0.3)";
  roundRect(ctx, drX - 140, drY - 20, 280, 44, 10); ctx.stroke();
  ctx.fillStyle = "#7b94b8";
  ctx.font = '10px ui-monospace, monospace';
  ctx.textAlign = "center";
  ctx.fillText("LANDING · DISTANCE · MULTIPLIER", drX, drY - 4);
  ctx.fillStyle = "#ffd76a";
  ctx.font = 'bold 17px "Rubik", sans-serif';
  ctx.fillText("OPEN SAND  ·  " + LAND_DISTANCE + "  →  " + LAND_MULT + "×", drX, drY + 18);

  // Subtle hazard hint under the HUD
  const hzY = drY + 38;
  ctx.fillStyle = "rgba(2,24,48,0.6)";
  roundRect(ctx, drX - 120, hzY, 240, 22, 6); ctx.fill();
  ctx.fillStyle = "rgba(255, 140, 140, 0.85)";
  ctx.font = '11px ui-monospace, monospace';
  ctx.textAlign = "center";
  ctx.fillText("◆ land on rock = bust  ·  land on sand = win", drX, hzY + 15);

  ctx.textAlign = "start";

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

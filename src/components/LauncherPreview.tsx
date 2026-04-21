"use client";

// Static visual preview of the cannon-style launcher: one input (FIRE),
// server rolls the outcome, distance-based multiplier. The further the
// squid flies, the bigger the payout — zones are spaced wide along a
// long landing strip with distance markers so the "distance = result"
// reading is obvious. Uses the pipes-game ocean atmosphere.

import { useEffect, useRef } from "react";
import { GROUND_H, type Bird } from "@/lib/simulate";
import { drawBird } from "@/lib/gameArt";

const PREVIEW_W = 1160;
const PREVIEW_H = 560;

type Bubble = { x: number; y: number; r: number; tw: number };
type Weed = { x: number; w: number; h: number; layer: 0 | 1 };

export function LauncherPreview() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext("2d"); if (!ctx) return;

    const bubbles: Bubble[] = [];
    for (let i = 0; i < 56; i++) {
      bubbles.push({
        x: (i * 97) % PREVIEW_W,
        y: 30 + ((i * 173) % (PREVIEW_H - GROUND_H - 60)),
        r: 1.2 + ((i * 7) % 20) / 10,
        tw: i,
      });
    }
    const weeds: Weed[] = [];
    for (let i = 0; i < 7; i++) weeds.push({ layer: 0, x: i * 170 + 30, w: 150, h: 80 });
    for (let i = 0; i < 7; i++) weeds.push({ layer: 1, x: i * 200 + 80, w: 180, h: 120 });

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

// ─── LANDING ZONES (distance-based multiplier) ───────────────────────
// Each zone is a spaced-out patch of seabed at increasing distance from
// the cannon. frac = position along the strip (0 = just past cannon,
// 1 = far end). Wider gaps between high-multiplier zones sell the
// "go further, win more" reading. Probabilities match the on-chain
// curve (8/15/30/30/14/2.5/0.5).
const ZONES = [
  { mult: 0,    label: "BUST",  distance:  "6m",  color: "#ff5a5a", frac: 0.04 },
  { mult: 0.7,  label: "0.7×",  distance: "22m",  color: "#ff9b5a", frac: 0.16 },
  { mult: 0.9,  label: "0.9×",  distance: "44m",  color: "#ffb464", frac: 0.30 },
  { mult: 1.05, label: "1.05×", distance: "72m",  color: "#cfe7ff", frac: 0.46 },
  { mult: 1.2,  label: "1.2×",  distance: "108m", color: "#cfd8dc", frac: 0.63 },
  { mult: 1.8,  label: "1.8×",  distance: "156m", color: "#ffd76a", frac: 0.79 },
  { mult: 5.0,  label: "5×",    distance: "220m", color: "#7fe3ff", frac: 0.95 },
];

// Snapshot bird position — mid-flight for dramatic screenshot. Fraction
// along the arc (0 = muzzle, 1 = landing point).
const BIRD_FRAC = 0.62;
// Which zone the arc is targeting for the snapshot (1.2×).
const TARGET_ZONE = 4;

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
  for (let i = 0; i < 9; i++) {
    const baseX = ((i * 170 + frame * 0.4) % (W2 + 240)) - 120;
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

  // ── LANDING STRIP — spaced-out zones with distance markers ──
  const stripY = H2 - GROUND_H - 2;
  const stripStart = 150;
  const stripEnd = W2 - 40;
  const stripW = stripEnd - stripStart;

  // Subtle ruled baseline
  ctx.strokeStyle = "rgba(255,255,255,0.1)";
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 6]);
  ctx.beginPath();
  ctx.moveTo(stripStart, stripY);
  ctx.lineTo(stripEnd, stripY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Vertical tick marks every 20m-equivalent for distance scale
  for (let i = 0; i <= 10; i++) {
    const x = stripStart + (stripW * i) / 10;
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.beginPath();
    ctx.moveTo(x, stripY - 4);
    ctx.lineTo(x, stripY + 2);
    ctx.stroke();
  }

  // Zone markers — each gets a spaced-out label chip + distance marker
  ZONES.forEach((z, i) => {
    const zx = stripStart + stripW * z.frac;
    const isTarget = i === TARGET_ZONE;

    // Glowing floor patch under the zone
    const patch = ctx.createRadialGradient(zx, stripY, 2, zx, stripY, 42);
    patch.addColorStop(0, z.color + "55");
    patch.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = patch;
    ctx.beginPath();
    ctx.ellipse(zx, stripY, 42, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    // Vertical beam up from the zone
    ctx.save();
    const beam = ctx.createLinearGradient(zx, stripY - 80, zx, stripY);
    beam.addColorStop(0, "rgba(0,0,0,0)");
    beam.addColorStop(1, z.color + (isTarget ? "80" : "30"));
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(zx - 3, stripY - 80);
    ctx.lineTo(zx + 3, stripY - 80);
    ctx.lineTo(zx + 6, stripY);
    ctx.lineTo(zx - 6, stripY);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Distance marker BELOW the strip (on the sand)
    ctx.fillStyle = "rgba(40,25,8,0.75)";
    roundRect(ctx, zx - 22, stripY + 6, 44, 14, 3);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.font = 'bold 9px ui-monospace, monospace';
    ctx.textAlign = "center";
    ctx.fillText(z.distance, zx, stripY + 16);

    // Multiplier chip ABOVE the beam (floating in water)
    const chipY = stripY - 94;
    const chipW = 64, chipH = 22;
    ctx.fillStyle = "rgba(2,24,48,0.9)";
    roundRect(ctx, zx - chipW / 2, chipY, chipW, chipH, 6);
    ctx.fill();
    ctx.strokeStyle = z.color;
    ctx.lineWidth = isTarget ? 2 : 1;
    roundRect(ctx, zx - chipW / 2, chipY, chipW, chipH, 6);
    ctx.stroke();
    if (isTarget) {
      ctx.shadowColor = z.color;
      ctx.shadowBlur = 12;
    }
    ctx.fillStyle = z.color;
    ctx.font = 'bold 12px "Rubik", sans-serif';
    ctx.fillText(z.label, zx, chipY + 15);
    ctx.shadowBlur = 0;

    // Bust zone gets a small red X on the sand so it's unambiguous;
    // other zones just read via the colored beam + chip + distance
    // marker. No chest tokens — the multiplier IS the chest here.
    if (z.mult === 0) {
      const itemY = stripY - 14;
      ctx.strokeStyle = "rgba(255, 90, 90, 0.85)";
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(zx - 7, itemY - 7); ctx.lineTo(zx + 7, itemY + 7);
      ctx.moveTo(zx + 7, itemY - 7); ctx.lineTo(zx - 7, itemY + 7);
      ctx.stroke();
    }
  });
  ctx.textAlign = "start";

  // ── DETAILED CANNON (left side) ──
  const cannonBaseX = 92;
  const cannonBaseY = H2 - GROUND_H;
  drawDetailedCannon(ctx, cannonBaseX, cannonBaseY, frame);

  // Coiled rope near the cannon base (touch of piracy)
  drawCoiledRope(ctx, cannonBaseX + 68, cannonBaseY - 6);
  // Stacked cannonball pyramid
  drawCannonballs(ctx, cannonBaseX - 46, cannonBaseY - 6);

  // ── TRAJECTORY preview arc + squid mid-flight ──
  const muzzleX = cannonBaseX + 62;
  const muzzleY = cannonBaseY - 58;
  const target = ZONES[TARGET_ZONE]!;
  const landX = stripStart + stripW * target.frac;
  const landY = stripY - 28;
  const midX = (muzzleX + landX) / 2;
  const apex = Math.min(muzzleY, landY) - 160;

  // Dotted trajectory
  ctx.save();
  ctx.setLineDash([4, 6]);
  ctx.strokeStyle = "rgba(127,227,255,0.4)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (let t = 0; t <= 1; t += 0.02) {
    const x = (1 - t) * (1 - t) * muzzleX + 2 * (1 - t) * t * midX + t * t * landX;
    const y = (1 - t) * (1 - t) * muzzleY + 2 * (1 - t) * t * apex   + t * t * landY;
    if (t === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();

  // Squid mid-flight at BIRD_FRAC along the arc
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
  ctx.save();
  for (let i = 1; i <= 6; i++) {
    const tt = Math.max(0, t - i * 0.025);
    const tx = (1 - tt) * (1 - tt) * muzzleX + 2 * (1 - tt) * tt * midX + tt * tt * landX;
    const ty = (1 - tt) * (1 - tt) * muzzleY + 2 * (1 - tt) * tt * apex + tt * tt * landY;
    ctx.fillStyle = `rgba(127, 227, 255, ${0.25 - i * 0.035})`;
    ctx.beginPath();
    ctx.arc(tx, ty, 6 - i * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // ── HUD: FIRE button + BET display ──
  // Big FIRE button (single input — this is the whole game)
  const fireX = 24, fireY = 24, fireW = 160, fireH = 58;
  const fireBg = ctx.createLinearGradient(fireX, fireY, fireX, fireY + fireH);
  fireBg.addColorStop(0, "#ffd76a");
  fireBg.addColorStop(1, "#e0a020");
  ctx.fillStyle = fireBg;
  roundRect(ctx, fireX, fireY, fireW, fireH, 12);
  ctx.fill();
  ctx.fillStyle = "#1a0a00";
  ctx.font = 'bold 20px "Rubik", sans-serif';
  ctx.textAlign = "center";
  ctx.fillText("FIRE", fireX + fireW / 2, fireY + 30);
  ctx.fillStyle = "rgba(26,10,0,0.7)";
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillText("one input · one result", fireX + fireW / 2, fireY + 48);

  // BET display
  const betX = W2 - 180, betY = 24, betW = 156, betH = 58;
  ctx.fillStyle = "rgba(2,24,48,0.78)";
  roundRect(ctx, betX, betY, betW, betH, 10); ctx.fill();
  ctx.strokeStyle = "rgba(127,227,255,0.35)";
  ctx.lineWidth = 1;
  roundRect(ctx, betX, betY, betW, betH, 10); ctx.stroke();
  ctx.fillStyle = "#7b94b8";
  ctx.font = '10px ui-monospace, monospace';
  ctx.textAlign = "left";
  ctx.fillText("BET", betX + 12, betY + 18);
  ctx.fillStyle = "#cfe7ff";
  ctx.font = 'bold 20px "Rubik", sans-serif';
  ctx.fillText("0.0100", betX + 12, betY + 44);
  ctx.fillStyle = "#7b94b8";
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillText("ETH", betX + 98, betY + 44);

  // Distance readout center-top — updates live when firing
  const drX = W2 / 2, drY = 34;
  ctx.fillStyle = "rgba(2,24,48,0.78)";
  roundRect(ctx, drX - 90, drY - 16, 180, 40, 9); ctx.fill();
  ctx.strokeStyle = "rgba(127,227,255,0.3)";
  roundRect(ctx, drX - 90, drY - 16, 180, 40, 9); ctx.stroke();
  ctx.fillStyle = "#7b94b8";
  ctx.font = '10px ui-monospace, monospace';
  ctx.textAlign = "center";
  ctx.fillText("DISTANCE · MULTIPLIER", drX, drY - 4);
  ctx.fillStyle = "#7fe3ff";
  ctx.font = 'bold 15px "Rubik", sans-serif';
  ctx.fillText("108m  →  1.2×", drX, drY + 16);

  // Vignette
  const vig = ctx.createRadialGradient(W2 / 2, H2 / 2, H2 * 0.45, W2 / 2, H2 / 2, H2 * 0.9);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,0.45)");
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

/// Detailed pirate-style cannon: tapered barrel, three brass bands with
/// iron rivets, trunnions, dolphin handles, muzzle flash smoke, wheeled
/// carriage with plank detail and spoked wheels. Ancored on the sand.
function drawDetailedCannon(ctx: CanvasRenderingContext2D, baseX: number, baseY: number, frame: number) {
  const angle = -0.55; // ~32° up

  // ── CARRIAGE (wooden cart) ──
  // Drawn before barrel so barrel sits on top
  const carX = baseX - 18, carY = baseY - 26;
  const carW = 64, carH = 22;

  // Carriage shadow on sand
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.ellipse(baseX + 10, baseY + 2, 62, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  // Wooden side cheek (two planks with grain lines)
  const woodGrad = ctx.createLinearGradient(0, carY, 0, carY + carH);
  woodGrad.addColorStop(0, "#8b5a2b");
  woodGrad.addColorStop(0.6, "#5a3816");
  woodGrad.addColorStop(1, "#2e1a08");
  ctx.fillStyle = woodGrad;
  // Main body
  ctx.beginPath();
  ctx.moveTo(carX, carY + 4);
  ctx.lineTo(carX + carW, carY);
  ctx.lineTo(carX + carW, carY + carH);
  ctx.lineTo(carX, carY + carH);
  ctx.closePath();
  ctx.fill();

  // Plank seams
  ctx.strokeStyle = "rgba(20,10,0,0.55)";
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const px = carX + (carW / 4) * i;
    ctx.beginPath();
    ctx.moveTo(px, carY + (1 - i / 4) * 4);
    ctx.lineTo(px, carY + carH);
    ctx.stroke();
  }
  // Wood grain strokes
  ctx.strokeStyle = "rgba(40,20,5,0.35)";
  for (let g = 0; g < 5; g++) {
    ctx.beginPath();
    ctx.moveTo(carX + 2, carY + 6 + g * 3);
    ctx.quadraticCurveTo(carX + carW / 2, carY + 6 + g * 3 + (g % 2 ? -1 : 1) * 1.5, carX + carW - 2, carY + 6 + g * 3);
    ctx.stroke();
  }

  // Iron bolts on the cheek
  ctx.fillStyle = "#1a1410";
  for (const [bx, by] of [[carX + 6, carY + 8], [carX + carW - 6, carY + 6], [carX + 6, carY + carH - 5], [carX + carW - 6, carY + carH - 5]]) {
    ctx.beginPath();
    ctx.arc(bx!, by!, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── BARREL (tapered, with 3 brass bands + rivets + trunnions) ──
  ctx.save();
  ctx.translate(baseX, baseY - 20);
  ctx.rotate(angle);

  // Barrel shadow
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.moveTo(-6, 10);
  ctx.lineTo(78, 12);
  ctx.lineTo(78, 14);
  ctx.lineTo(-6, 14);
  ctx.closePath();
  ctx.fill();

  // Barrel body — tapered (wider at muzzle, narrower at breech)
  // Draw as polygon for tapering
  const barrelGrad = ctx.createLinearGradient(0, -16, 0, 16);
  barrelGrad.addColorStop(0, "#5a5048");
  barrelGrad.addColorStop(0.35, "#2a2218");
  barrelGrad.addColorStop(0.55, "#1a140c");
  barrelGrad.addColorStop(1, "#0a0804");
  ctx.fillStyle = barrelGrad;
  ctx.beginPath();
  ctx.moveTo(-12, -10);              // breech top
  ctx.lineTo(68, -14);               // muzzle top
  ctx.lineTo(72, -16);               // muzzle lip top
  ctx.lineTo(72, 16);                // muzzle lip bottom
  ctx.lineTo(68, 14);                // muzzle bottom
  ctx.lineTo(-12, 10);               // breech bottom
  ctx.lineTo(-18, 6);                // cascabel bump
  ctx.lineTo(-20, 0);
  ctx.lineTo(-18, -6);
  ctx.closePath();
  ctx.fill();

  // Highlight strip along top of barrel
  const hiGrad = ctx.createLinearGradient(0, -10, 0, -4);
  hiGrad.addColorStop(0, "rgba(255,255,255,0.28)");
  hiGrad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = hiGrad;
  ctx.beginPath();
  ctx.moveTo(-12, -10); ctx.lineTo(68, -14); ctx.lineTo(68, -11); ctx.lineTo(-12, -7);
  ctx.closePath();
  ctx.fill();

  // Three brass bands with iron rivets
  const bandPositions = [0, 26, 58]; // along the barrel
  for (const bx of bandPositions) {
    // Taper interpolation for band height
    const tb = (bx + 20) / 92;
    const bandH = 10 + (1 - tb) * 4;
    // Brass band
    const brass = ctx.createLinearGradient(0, -bandH, 0, bandH);
    brass.addColorStop(0, "#f4d48a");
    brass.addColorStop(0.5, "#c28e4a");
    brass.addColorStop(1, "#6a4820");
    ctx.fillStyle = brass;
    ctx.fillRect(bx - 2, -bandH - 1, 5, bandH * 2 + 2);
    // Rivets
    ctx.fillStyle = "#1a1008";
    ctx.beginPath();
    ctx.arc(bx + 0.5, -bandH + 2, 1.1, 0, Math.PI * 2);
    ctx.arc(bx + 0.5, bandH - 2, 1.1, 0, Math.PI * 2);
    ctx.fill();
  }

  // Muzzle lip (brass rim)
  const lipGrad = ctx.createLinearGradient(0, -16, 0, 16);
  lipGrad.addColorStop(0, "#f4d48a");
  lipGrad.addColorStop(0.5, "#c28e4a");
  lipGrad.addColorStop(1, "#6a4820");
  ctx.fillStyle = lipGrad;
  ctx.fillRect(68, -16, 4, 32);
  // Inside of muzzle (dark)
  ctx.fillStyle = "#050302";
  ctx.beginPath();
  ctx.ellipse(71, 0, 2, 10, 0, 0, Math.PI * 2);
  ctx.fill();

  // Trunnion pivot circle
  ctx.fillStyle = "#2a2218";
  ctx.beginPath();
  ctx.arc(14, 14, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#8a7850";
  ctx.beginPath();
  ctx.arc(14, 14, 3, 0, Math.PI * 2);
  ctx.fill();

  // Dolphin handle on top (decorative lifting loop)
  ctx.strokeStyle = "#c28e4a";
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(22, -10);
  ctx.quadraticCurveTo(28, -18, 34, -10);
  ctx.stroke();

  // Cascabel ball (rear knob)
  const casc = ctx.createRadialGradient(-19, 0, 1, -19, 0, 6);
  casc.addColorStop(0, "#5a5048");
  casc.addColorStop(1, "#0a0804");
  ctx.fillStyle = casc;
  ctx.beginPath();
  ctx.arc(-19, 0, 5, 0, Math.PI * 2);
  ctx.fill();

  // Muzzle smoke — layered puffs with movement
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

  // Glowing muzzle flash
  const flash = ctx.createRadialGradient(74, 0, 1, 74, 0, 18);
  flash.addColorStop(0, "rgba(255, 220, 140, 0.8)");
  flash.addColorStop(0.4, "rgba(255, 160, 60, 0.4)");
  flash.addColorStop(1, "rgba(255, 80, 20, 0)");
  ctx.fillStyle = flash;
  ctx.beginPath();
  ctx.arc(74, 0, 18, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  // ── WHEELS (spoked) ──
  for (const wx of [baseX - 10, baseX + 22]) {
    // Outer iron rim
    ctx.fillStyle = "#1a140a";
    ctx.beginPath();
    ctx.arc(wx, baseY - 6, 14, 0, Math.PI * 2);
    ctx.fill();
    // Wooden disk
    const wheelGrad = ctx.createRadialGradient(wx, baseY - 6, 2, wx, baseY - 6, 12);
    wheelGrad.addColorStop(0, "#8b5a2b");
    wheelGrad.addColorStop(1, "#3a2310");
    ctx.fillStyle = wheelGrad;
    ctx.beginPath();
    ctx.arc(wx, baseY - 6, 12, 0, Math.PI * 2);
    ctx.fill();
    // Spokes
    ctx.strokeStyle = "#2a1a08";
    ctx.lineWidth = 2;
    for (let s = 0; s < 6; s++) {
      const a = (s / 6) * Math.PI * 2 + frame * 0.003;
      ctx.beginPath();
      ctx.moveTo(wx, baseY - 6);
      ctx.lineTo(wx + Math.cos(a) * 12, baseY - 6 + Math.sin(a) * 12);
      ctx.stroke();
    }
    // Hub
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
  // Small pyramid: 3 on bottom, 2 on top, 1 on top-top
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
    // Tiny highlight
    ctx.fillStyle = `rgba(255,255,255,${0.15 + row * 0.05})`;
    ctx.beginPath();
    ctx.arc(bx - 1.2, by - 1.2, 1, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCoiledRope(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  // Concentric coils, top-down view
  ctx.strokeStyle = "#d4b080";
  ctx.lineWidth = 2.4;
  ctx.lineCap = "round";
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(cx, cy, 5 + i * 2.5, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Twist texture dots
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

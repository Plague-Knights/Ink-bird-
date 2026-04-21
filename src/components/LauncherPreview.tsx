"use client";

// Static visual preview of the Moonsheep-style launcher, reusing every
// existing art asset (drawBird, drawPipe, drawChest, drawDroplet + the
// ocean scene layers). No gameplay logic — just a snapshot of what the
// layout would look like so we can get sign-off before wiring it up.

import { useEffect, useRef } from "react";
import { W, H, GROUND_H, type Bird } from "@/lib/simulate";
import { drawBird, drawChest, drawDroplet } from "@/lib/gameArt";

const PREVIEW_W = 960; // wider than the flappy layout so the landing strip reads
const PREVIEW_H = 560;

type Bubble = { x: number; y: number; r: number; tw: number };
type Weed = { x: number; w: number; h: number; layer: 0 | 1 };

export function LauncherPreview() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext("2d"); if (!ctx) return;

    // Static parallax for the mockup — fixed values so the layout is
    // stable for a screenshot.
    const bubbles: Bubble[] = [];
    for (let i = 0; i < 48; i++) {
      bubbles.push({
        x: (i * 97) % PREVIEW_W,
        y: 30 + (i * 173) % (PREVIEW_H - GROUND_H - 60),
        r: 1.2 + ((i * 7) % 20) / 10,
        tw: i,
      });
    }
    const weeds: Weed[] = [];
    for (let i = 0; i < 6; i++) weeds.push({ layer: 0, x: i * 170 + 30, w: 150, h: 80 });
    for (let i = 0; i < 6; i++) weeds.push({ layer: 1, x: i * 200 + 100, w: 180, h: 120 });

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

// ─── LANDING STRIP CONFIG ────────────────────────────────────────────
// Seven multiplier zones across the arc — same 7 buckets as the on-
// chain curve. Shorter arc = lower multiplier; longer = bigger payout.
const ZONES = [
  { mult: 0,    label: "BUST", color: "#ff5a5a", frac: 0.12 }, //  8%
  { mult: 0.7,  label: "0.7×", color: "#ff9b5a", frac: 0.20 }, // 15%
  { mult: 0.9,  label: "0.9×", color: "#ffb464", frac: 0.30 }, // 30%
  { mult: 1.05, label: "1.05×",color: "#cfe7ff", frac: 0.44 }, // 30%
  { mult: 1.2,  label: "1.2×", color: "#cfd8dc", frac: 0.60 }, // 14%
  { mult: 1.8,  label: "1.8×", color: "#ffd76a", frac: 0.78 }, //  2.5%
  { mult: 5.0,  label: "5×",   color: "#7fe3ff", frac: 0.92 }, //  0.5%
];

// Snapshot bird position — mid-flight for dramatic screenshot.
const BIRD_FRAC = 0.62;

function render(
  ctx: CanvasRenderingContext2D,
  bubbles: Bubble[],
  weeds: Weed[],
  frame: number,
) {
  const W2 = PREVIEW_W, H2 = PREVIEW_H;
  ctx.clearRect(0, 0, W2, H2);

  // Sky / ocean gradient (exact colors from AutoFlapper)
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
  for (let i = 0; i < 7; i++) {
    const baseX = ((i * 160 + frame * 0.4) % (W2 + 240)) - 120;
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

  // ── LANDING STRIP (zone markers along the arc's landing line) ──
  const stripY = H2 - GROUND_H - 4;
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fillRect(90, stripY - 12, W2 - 120, 14);
  ZONES.forEach(z => {
    const zx = 90 + (W2 - 120) * z.frac;
    // tick mark
    ctx.fillStyle = z.color;
    ctx.fillRect(zx - 1, stripY - 14, 2, 14);
    // label chip
    ctx.fillStyle = "rgba(2,24,48,0.85)";
    ctx.fillRect(zx - 28, stripY - 34, 56, 16);
    ctx.strokeStyle = z.color;
    ctx.lineWidth = 1;
    ctx.strokeRect(zx - 28, stripY - 34, 56, 16);
    ctx.fillStyle = z.color;
    ctx.font = 'bold 10px "Rubik", ui-monospace, monospace';
    ctx.textAlign = "center";
    ctx.fillText(z.label, zx, stripY - 22);
  });
  ctx.textAlign = "start";

  // Chests + drops along the landing zone so it reads as "the loot"
  ZONES.forEach((z, i) => {
    const zx = 90 + (W2 - 120) * z.frac;
    const zy = stripY - 55;
    if (z.mult === 0) {
      // Bust zone — skull via a darker ink drop
      ctx.save();
      ctx.globalAlpha = 0.5;
      drawDroplet(ctx, zx, zy, 10, frame);
      ctx.restore();
    } else if (z.mult >= 1.8) {
      // Rare / jackpot: chest sprite with fancy tier
      const tier: 0 | 1 | 2 | 3 = z.mult >= 5 ? 3 : 2;
      drawChest(ctx, zx, zy, frame, tier);
    } else if (z.mult >= 1.05) {
      // Small wins: plain chest
      drawChest(ctx, zx, zy, frame, i === 3 ? 0 : 1);
    } else {
      // Loss-ish zones: regular ink drop
      drawDroplet(ctx, zx, zy, 10, frame);
    }
  });

  // ── CANNON (left side) ──
  const cannonBaseX = 70;
  const cannonBaseY = H2 - GROUND_H - 8;
  // Barrel (angled up-right)
  ctx.save();
  ctx.translate(cannonBaseX, cannonBaseY);
  ctx.rotate(-0.55); // ~32° up
  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(-6, 4, 70, 4);
  // Body
  const cannon = ctx.createLinearGradient(0, -12, 0, 12);
  cannon.addColorStop(0, "#6e3922");
  cannon.addColorStop(0.5, "#3a2013");
  cannon.addColorStop(1, "#1d100a");
  ctx.fillStyle = cannon;
  ctx.fillRect(-8, -12, 78, 24);
  // Rim
  ctx.strokeStyle = "#c28e5b";
  ctx.lineWidth = 2;
  ctx.strokeRect(-8, -12, 78, 24);
  // Muzzle ring
  ctx.fillStyle = "#8e5a33";
  ctx.fillRect(64, -14, 8, 28);
  // Muzzle smoke puff
  ctx.fillStyle = "rgba(240,240,240,0.45)";
  ctx.beginPath();
  ctx.arc(78, 0, 10 + Math.sin(frame * 0.12) * 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(240,240,240,0.25)";
  ctx.beginPath();
  ctx.arc(86, -4, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // Wheels
  ctx.fillStyle = "#1d100a";
  ctx.beginPath(); ctx.arc(cannonBaseX - 4, cannonBaseY + 6, 14, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cannonBaseX + 22, cannonBaseY + 6, 14, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#8e5a33";
  ctx.beginPath(); ctx.arc(cannonBaseX - 4, cannonBaseY + 6, 4, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cannonBaseX + 22, cannonBaseY + 6, 4, 0, Math.PI * 2); ctx.fill();

  // ── TRAJECTORY preview arc + squid mid-flight ──
  const launchX = cannonBaseX + 70; // muzzle end (approximate)
  const launchY = cannonBaseY - 40;
  const landX = 90 + (W2 - 120) * 0.62; // visual target around the 1.05× zone
  const landY = stripY - 55;
  // Parabola from (launchX, launchY) to (landX, landY), apex ~120px above midpoint
  const midX = (launchX + landX) / 2;
  const apex = Math.min(launchY, landY) - 130;

  // Dotted trajectory
  ctx.save();
  ctx.setLineDash([4, 6]);
  ctx.strokeStyle = "rgba(127,227,255,0.4)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (let t = 0; t <= 1; t += 0.02) {
    // Quadratic bezier through (launch, apex-at-mid, land)
    const x = (1 - t) * (1 - t) * launchX + 2 * (1 - t) * t * midX + t * t * landX;
    const y = (1 - t) * (1 - t) * launchY + 2 * (1 - t) * t * apex   + t * t * landY;
    if (t === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();

  // Squid mid-flight at BIRD_FRAC along the arc
  const t = BIRD_FRAC;
  const bx = (1 - t) * (1 - t) * launchX + 2 * (1 - t) * t * midX + t * t * landX;
  const by = (1 - t) * (1 - t) * launchY + 2 * (1 - t) * t * apex   + t * t * landY;
  const bird: Bird = { x: bx, y: by, vy: 0, r: 18 };
  // Orient squid along trajectory slope
  const slope = Math.atan2(
    2 * (1 - t) * (apex - launchY) + 2 * t * (landY - apex),
    2 * (1 - t) * (midX - launchX) + 2 * t * (landX - midX),
  );
  drawBird(ctx, bird, slope * 1.5, frame * 0.6, frame);

  // ── HUD: angle dial + fire button mockup ──
  // Angle dial
  ctx.fillStyle = "rgba(2,24,48,0.78)";
  ctx.fillRect(24, 24, 130, 52);
  ctx.strokeStyle = "rgba(127,227,255,0.35)";
  ctx.strokeRect(24, 24, 130, 52);
  ctx.fillStyle = "#7b94b8";
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillText("ANGLE", 36, 42);
  ctx.font = 'bold 18px "Rubik", sans-serif';
  ctx.fillStyle = "#cfe7ff";
  ctx.fillText("32°", 36, 66);
  // Slider dots
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i < 4 ? "#7fe3ff" : "rgba(127,227,255,0.2)";
    ctx.fillRect(80 + i * 8, 56, 5, 3);
  }

  // Fire button
  ctx.fillStyle = "#7fe3ff";
  ctx.fillRect(24, 90, 130, 38);
  ctx.fillStyle = "#021830";
  ctx.font = 'bold 13px "Rubik", sans-serif';
  ctx.textAlign = "center";
  ctx.fillText("FIRE", 24 + 65, 114);
  ctx.textAlign = "start";

  // Bet display
  ctx.fillStyle = "rgba(2,24,48,0.78)";
  ctx.fillRect(W2 - 180, 24, 156, 52);
  ctx.strokeStyle = "rgba(127,227,255,0.35)";
  ctx.strokeRect(W2 - 180, 24, 156, 52);
  ctx.fillStyle = "#7b94b8";
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillText("BET", W2 - 170, 42);
  ctx.fillStyle = "#cfe7ff";
  ctx.font = 'bold 16px "Rubik", sans-serif';
  ctx.fillText("0.0100 ETH", W2 - 170, 66);

  // Vignette
  const vig = ctx.createRadialGradient(W2 / 2, H2 / 2, H2 * 0.45, W2 / 2, H2 / 2, H2 * 0.9);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,0.45)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W2, H2);
}

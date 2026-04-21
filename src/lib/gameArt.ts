// Shared rendering primitives for the squid game. Extracted from
// Game.tsx so both the live skill game and the auto-flapper render
// identically — same pipes, same squid sprite, same scene parts.

import { type Bird } from "./simulate";
import { H, GROUND_H, PIPE_GAP, PIPE_WIDTH } from "./simulate";

/// Draws a treasure chest at (x, y) sized to the original droplet
/// hitbox (~r=10). The auto-flapper game uses these in place of the
/// upstream ink-droplet visual: same simulate.ts hit logic, different
/// art so it reads as a prize-bearing chest.
///
/// `tier` shifts color + glow strength so the visual hints at value
/// without leaking the actual prize before the squid grabs it:
///   0 = common (wood + bronze trim)
///   1 = uncommon (wood + silver trim, faint glow)
///   2 = rare (wood + gold trim, strong glow)
///   3 = jackpot (purple + cyan glow halo)
export function drawChest(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  frame: number,
  tier: 0 | 1 | 2 | 3 = 0,
) {
  const bob = Math.sin(frame * 0.12 + x * 0.03) * 2.2;
  const cy = y + bob;

  const palette = (() => {
    switch (tier) {
      case 3: return { wood: ["#3a1858", "#1a0830"], trim: "#7fe3ff", glow: "rgba(127,227,255,0.65)" };
      case 2: return { wood: ["#7a4a20", "#3a2410"], trim: "#ffd76a", glow: "rgba(255,215,106,0.55)" };
      case 1: return { wood: ["#7a4a20", "#3a2410"], trim: "#cfd8dc", glow: "rgba(207,216,220,0.4)" };
      default: return { wood: ["#7a4a20", "#3a2410"], trim: "#b07a3a", glow: "rgba(255,180,100,0.3)" };
    }
  })();

  const w = 24, hBody = 13, hLid = 9;
  const left = x - w / 2;
  const right = x + w / 2;
  const lidTop = cy - (hBody + hLid) / 2;
  const seam = lidTop + hLid;
  const bottom = seam + hBody;
  const cornerR = 4; // body corner radius — kills the "square" silhouette

  // Halo — small for common, larger / brighter for rarer tiers.
  const haloR = tier === 3 ? 26 : tier === 2 ? 20 : 16;
  const halo = ctx.createRadialGradient(x, cy, 1, x, cy, haloR);
  halo.addColorStop(0, palette.glow);
  halo.addColorStop(1, palette.glow.replace(/[\d.]+\)$/, "0)"));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(x, cy, haloR, 0, Math.PI * 2);
  ctx.fill();

  // Soft drop shadow under the chest.
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(x, bottom + 2, w * 0.45, 2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Body — rounded-rect path so the silhouette curves at the corners
  // instead of reading as a flat-edged box.
  const body = ctx.createLinearGradient(0, seam, 0, bottom);
  body.addColorStop(0, palette.wood[0]!);
  body.addColorStop(1, palette.wood[1]!);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(left + cornerR, seam);
  ctx.lineTo(right - cornerR, seam);
  ctx.quadraticCurveTo(right, seam, right, seam + cornerR);
  ctx.lineTo(right, bottom - cornerR);
  ctx.quadraticCurveTo(right, bottom, right - cornerR, bottom);
  ctx.lineTo(left + cornerR, bottom);
  ctx.quadraticCurveTo(left, bottom, left, bottom - cornerR);
  ctx.lineTo(left, seam + cornerR);
  ctx.quadraticCurveTo(left, seam, left + cornerR, seam);
  ctx.closePath();
  ctx.fill();

  // Lid — full half-dome rather than the previous shallow arch, so it
  // reads as "rounded chest" not "box with a slanted top."
  ctx.fillStyle = palette.wood[0]!;
  ctx.beginPath();
  ctx.moveTo(left, seam);
  ctx.lineTo(left, lidTop + 3);
  ctx.bezierCurveTo(left + 2, lidTop - 4, right - 2, lidTop - 4, right, lidTop + 3);
  ctx.lineTo(right, seam);
  ctx.closePath();
  ctx.fill();

  // Single seam band + a curved center strap up the lid for character
  // (no more horizontal-vertical grid that looked like a checkered box).
  ctx.fillStyle = palette.trim;
  ctx.fillRect(left + 1, seam - 1, w - 2, 2);
  ctx.beginPath();
  ctx.moveTo(x - 1.5, seam);
  ctx.bezierCurveTo(x - 1.5, lidTop, x + 1.5, lidTop, x + 1.5, seam);
  ctx.lineTo(x - 1.5, seam);
  ctx.fill();

  // Lock — circular boss instead of a flat rectangle.
  ctx.fillStyle = palette.trim;
  ctx.beginPath();
  ctx.arc(x, seam + 1, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#0a0810";
  ctx.fillRect(x - 0.7, seam + 0.5, 1.4, 1.4);

  // Soft sheen on the dome.
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.beginPath();
  ctx.ellipse(x - 3, lidTop + 1.5, w * 0.28, 1.6, -0.3, 0, Math.PI * 2);
  ctx.fill();
}

/// Pick the visual for a collectible deterministically from its
/// position. Most collectibles render as the regular ink drop; a
/// minority appear as treasure chests of varying tiers. Same drop
/// position always → same kind, so it doesn't change between render
/// frames. Replace with seed-derived outcome once the on-chain
/// contract is wired in.
export type CollectibleKind =
  | { kind: "drop" }
  | { kind: "chest"; tier: 0 | 1 | 2 | 3 };

export function collectibleForPos(_x: number, y: number): CollectibleKind {
  // Hash off Y only — Y is set at droplet spawn and never changes,
  // while X scrolls left every frame. Hashing off X meant the same
  // physical droplet flickered between drop and chest as it moved
  // across the screen ("flashing chest behind the ink drops").
  const yi = Math.round(y * 1000); // ×1000 so fractional Y still differentiates droplets
  const h = (Math.imul(yi ^ 0x9e3779b1, 0x85ebca6b) ^ Math.imul(yi ^ 0xc2b2ae35, 0xc2b2ae35)) >>> 0;
  const r = (h % 10000) / 10000;
  // Chests are rare — typical run is mostly ink drops with one chest
  // appearance every several pipes on average. Mirrors the on-chain
  // outcome curve (most positions empty, occasional small, rare
  // medium, very rare big, vanishing jackpot).
  if (r < 0.92)  return { kind: "drop" };           // 92% ink drop
  if (r < 0.975) return { kind: "chest", tier: 0 }; //  5.5% common
  if (r < 0.994) return { kind: "chest", tier: 1 }; //  1.9% uncommon
  if (r < 0.999) return { kind: "chest", tier: 2 }; //  0.5% rare
  return { kind: "chest", tier: 3 };                //  0.1% jackpot
}

/// Original ink-droplet visual from the live skill game — kept here
/// so the auto-flapper can mix drops and chests without re-importing
/// component-level code.
export function drawDroplet(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  frame: number,
) {
  const yy = y + Math.sin(frame * 0.15) * 3;
  const halo = ctx.createRadialGradient(x, yy, 2, x, yy, r * 2.4);
  halo.addColorStop(0, "rgba(180, 140, 255, 0.55)");
  halo.addColorStop(1, "rgba(180, 140, 255, 0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(x, yy, r * 2.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(x, yy);
  const body = ctx.createRadialGradient(-3, -4, 1, 0, 0, r);
  body.addColorStop(0, "#6a3fd0");
  body.addColorStop(0.6, "#2a1060");
  body.addColorStop(1, "#0a0224");
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(0, -r * 1.25);
  ctx.bezierCurveTo(r * 1.05, -r * 0.2, r, r, 0, r);
  ctx.bezierCurveTo(-r, r, -r * 1.05, -r * 0.2, 0, -r * 1.25);
  ctx.fill();
  ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
  ctx.beginPath();
  ctx.ellipse(-r * 0.3, -r * 0.3, r * 0.22, r * 0.38, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawPipe(
  ctx: CanvasRenderingContext2D,
  x: number,
  topH: number,
  isTop: boolean,
  frame: number,
) {
  const y = isTop ? 0 : topH + PIPE_GAP;
  const h = isTop ? topH : H - GROUND_H - (topH + PIPE_GAP);

  const grad = ctx.createLinearGradient(x, 0, x + PIPE_WIDTH, 0);
  grad.addColorStop(0, "#10202f");
  grad.addColorStop(0.5, "#456680");
  grad.addColorStop(1, "#10202f");
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, PIPE_WIDTH, h);

  ctx.fillStyle = "rgba(0,0,0,0.22)";
  const seed = x | 0;
  for (let i = 0; i < 10; i++) {
    const rx = x + 4 + ((i * 13 + seed * 7) % (PIPE_WIDTH - 8));
    const ry = y + 8 + ((i * 29 + seed * 11) % Math.max(1, h - 16));
    ctx.beginPath();
    ctx.arc(rx, ry, 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fillRect(x + 8, y, 3, h);

  const capH = 14;
  const capY = isTop ? y + h - capH : y;
  const cap = ctx.createLinearGradient(x, 0, x + PIPE_WIDTH, 0);
  cap.addColorStop(0, "#18344a");
  cap.addColorStop(0.5, "#5d87a8");
  cap.addColorStop(1, "#18344a");
  ctx.fillStyle = cap;
  ctx.fillRect(x - 5, capY, PIPE_WIDTH + 10, capH);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(x - 5, isTop ? capY : capY + capH - 2, PIPE_WIDTH + 10, 2);

  const edgeY = isTop ? capY + capH : capY;
  const dir = isTop ? 1 : -1;
  const tendrils = 11;
  for (let i = 0; i < tendrils; i++) {
    const tx = x + 2 + i * ((PIPE_WIDTH - 4) / (tendrils - 1));
    const wave = Math.sin(frame * 0.08 + i * 0.7 + x * 0.02);
    const tipX = tx + wave * 3;
    const tipY = edgeY + dir * (6 + (i % 3) * 3);
    ctx.strokeStyle = i % 2 === 0 ? "#ff7aa8" : "#ff4f8b";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(tx, edgeY);
    ctx.quadraticCurveTo(tx + wave * 2, edgeY + dir * 4, tipX, tipY);
    ctx.stroke();
    ctx.fillStyle = "#ffc2d7";
    ctx.beginPath();
    ctx.arc(tipX, tipY, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawBird(
  ctx: CanvasRenderingContext2D,
  bird: Bird,
  rot: number,
  flapPhase: number,
  frame: number,
) {
  ctx.save();
  ctx.translate(bird.x, bird.y);

  const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, bird.r * 2.6);
  glow.addColorStop(0, "rgba(120, 200, 255, 0.22)");
  glow.addColorStop(1, "rgba(120, 200, 255, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, bird.r * 2.6, 0, Math.PI * 2);
  ctx.fill();

  ctx.rotate(rot * 0.55);

  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.beginPath();
  ctx.ellipse(0, bird.r + 3, bird.r + 2, 2.5, 0, 0, Math.PI * 2);
  ctx.fill();

  const mantleLen = bird.r + 9;
  const mantleH = bird.r - 2;
  const waveT = frame * 0.2 + flapPhase * 0.5;
  const armBaseX = -mantleLen * 0.38;

  const arms = 8;
  for (let i = 0; i < arms; i++) {
    const row = (i - (arms - 1) / 2) / arms;
    const yStart = row * (mantleH * 1.1);
    const len = 18 + Math.abs(row) * 5;
    ctx.strokeStyle = "#4a2a9c";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(armBaseX, yStart);
    for (let s = 1; s <= 5; s++) {
      const t = s / 5;
      ctx.lineTo(armBaseX - t * len, yStart + Math.sin(waveT + i * 0.7 + t * 3) * 4 * t);
    }
    ctx.stroke();
    ctx.strokeStyle = "#8e67e0";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(armBaseX, yStart);
    for (let s = 1; s <= 5; s++) {
      const t = s / 5;
      ctx.lineTo(armBaseX - t * len, yStart + Math.sin(waveT + i * 0.7 + t * 3) * 4 * t);
    }
    ctx.stroke();
  }

  for (const sign of [-1, 1]) {
    const y0 = sign * mantleH * 0.5;
    ctx.strokeStyle = "#2a1358";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(armBaseX, y0);
    let lx = armBaseX, ly = y0;
    for (let s = 1; s <= 6; s++) {
      const t = s / 6;
      lx = armBaseX - t * 28;
      ly = y0 + Math.sin(waveT * 1.1 + t * 4 + sign) * 5 * t;
      ctx.lineTo(lx, ly);
    }
    ctx.stroke();
    ctx.fillStyle = "#7c4fd6";
    ctx.beginPath();
    ctx.ellipse(lx, ly, 3.2, 2.2, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "#4a2a9c";
  ctx.beginPath();
  ctx.moveTo(-mantleLen * 0.15, -mantleH * 0.9);
  ctx.quadraticCurveTo(-mantleLen * 0.55, -mantleH - 6, -mantleLen * 0.45, -mantleH * 0.6);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-mantleLen * 0.15, mantleH * 0.9);
  ctx.quadraticCurveTo(-mantleLen * 0.55, mantleH + 6, -mantleLen * 0.45, mantleH * 0.6);
  ctx.closePath();
  ctx.fill();

  const mantle = ctx.createLinearGradient(0, -mantleH, 0, mantleH);
  mantle.addColorStop(0, "#c8aef5");
  mantle.addColorStop(0.55, "#7c4fd6");
  mantle.addColorStop(1, "#311766");
  ctx.fillStyle = mantle;
  ctx.beginPath();
  ctx.moveTo(mantleLen, 0);
  ctx.bezierCurveTo(mantleLen * 0.6, -mantleH, -mantleLen * 0.3, -mantleH, -mantleLen * 0.4, 0);
  ctx.bezierCurveTo(-mantleLen * 0.3, mantleH, mantleLen * 0.6, mantleH, mantleLen, 0);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.beginPath();
  ctx.ellipse(mantleLen * 0.1, -mantleH * 0.55, mantleLen * 0.45, mantleH * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(255, 210, 230, 0.45)";
  ctx.beginPath();
  ctx.arc(mantleLen * 0.1, mantleH * 0.5, 2.5, 0, Math.PI * 2);
  ctx.arc(-mantleLen * 0.15, mantleH * 0.45, 2, 0, Math.PI * 2);
  ctx.fill();

  const eyeY = -mantleH * 0.15;
  for (const ex of [mantleLen * 0.4, mantleLen * 0.15]) {
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(ex, eyeY, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#0a0320";
    ctx.beginPath();
    ctx.arc(ex + 1, eyeY + 0.5, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(ex + 1.8, eyeY - 0.8, 1, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "rgba(255, 150, 180, 0.4)";
  ctx.beginPath();
  ctx.ellipse(mantleLen * 0.3, mantleH * 0.25, 3.5, 1.8, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

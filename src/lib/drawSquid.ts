// Procedural squid drawing lifted from the main flappy game's drawBird
// in src/components/Game.tsx. Same exact gradients, tentacle wave, eye
// sparkle — this is how we keep /cannon visually consistent with
// squid.inkswap.io without reaching for 3D models.
//
// Signature is intentionally self-contained: pass in a context, a
// position + radius, and an animation phase. No dependency on the
// flappy simulation state.

export type SquidPose = {
  x: number;
  y: number;
  r: number;           // base "bird radius" from the main game — 11-13 typical
  rotRad: number;      // rotation in radians (positive = diving forward)
  flapPhase: number;   // accumulates during a flap for tentacle wave sync
  frame: number;       // global frame counter for tentacle undulation
};

export function drawSquid(ctx: CanvasRenderingContext2D, pose: SquidPose) {
  const { x, y, r, rotRad, flapPhase, frame } = pose;
  ctx.save();
  ctx.translate(x, y);

  const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, r * 2.6);
  glow.addColorStop(0, "rgba(120, 200, 255, 0.22)");
  glow.addColorStop(1, "rgba(120, 200, 255, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, r * 2.6, 0, Math.PI * 2);
  ctx.fill();

  ctx.rotate(rotRad * 0.55);

  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.beginPath();
  ctx.ellipse(0, r + 3, r + 2, 2.5, 0, 0, Math.PI * 2);
  ctx.fill();

  const mantleLen = r + 9;
  const mantleH = r - 2;
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

  ctx.restore();
}

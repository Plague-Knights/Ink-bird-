"use client";

import { useEffect, useMemo, useRef } from "react";
import { drawSquid } from "@/lib/drawSquid";

export type CannonEvent =
  | { kind: "blot"; value: number }
  | { kind: "hazard" };

type Props = {
  events: readonly CannonEvent[] | null;
  animating: boolean;
  onAnimDone: () => void;
  onMultiplierUpdate?: (bps: number) => void;
  angleDeg: number; // 20..80
};

// Portrait canvas matching the main flappy game aspect (480x640-ish).
// The *world* is ~3000 units wide though — camera scrolls horizontally
// to follow the squid, just like the flappy game scrolls pipes past
// the bird.
const W = 480;
const H = 760;

const GROUND_H = 96;
const CANNON_WORLD_X = 100;
const GROUND_Y = H - GROUND_H;
const PLATFORM_Y = GROUND_Y - 10;

const GRAVITY = 820;       // world units per second^2
const LAUNCH_POWER = 820;  // initial speed in world units per second
const FLIGHT_MAX_SECONDS = 10;

const SPAN_TRAVEL_PER_BLOT = 180;
const SPAN_TAIL_WORLD = 260;

const LINGER_SECONDS = 1.0;

type Weed = { layer: 0 | 1; x: number; w: number; h: number };
type Bubble = { x: number; y: number; r: number; tw: number; vy: number };

function blotCount(events: readonly CannonEvent[] | null): number {
  if (!events) return 0;
  let n = 0;
  for (const e of events) if (e.kind === "blot") n++;
  return n;
}

function hasHazard(events: readonly CannonEvent[] | null): boolean {
  return events?.some((e) => e.kind === "hazard") ?? false;
}

// Physics helpers ------------------------------------------------------

type Traj = {
  durationSec: number;
  vx: number;
  vy0: number;  // velocity at launch, negative = up (canvas y down)
  startX: number;
  startY: number;
  // Full max reach — we scale `--power` to make the squid travel roughly
  // SPAN_TRAVEL_PER_BLOT per collectible so short runs don't look tiny
  // and long runs don't overshoot.
  peakY: number;
  landingX: number;
};

function computeTrajectory(angleDeg: number, events: readonly CannonEvent[] | null): Traj {
  const blots = blotCount(events);
  const travel = Math.max(260, blots * SPAN_TRAVEL_PER_BLOT + SPAN_TAIL_WORLD);
  const a = (angleDeg * Math.PI) / 180;
  // Solve for initial speed that reaches `travel` horizontally at this
  // angle. Range = v² * sin(2a) / g → v = sqrt(range * g / sin(2a)).
  const sin2a = Math.max(0.1, Math.sin(2 * a));
  const vMag = Math.min(2200, Math.sqrt((travel * GRAVITY) / sin2a));
  const vx = Math.cos(a) * vMag;
  const vy0 = -Math.sin(a) * vMag;
  const duration = Math.min(FLIGHT_MAX_SECONDS, (-2 * vy0) / GRAVITY);
  // Peak (for camera clamping)
  const peakT = -vy0 / GRAVITY;
  const peakY = PLATFORM_Y + vy0 * peakT + 0.5 * GRAVITY * peakT * peakT;
  const landingX = CANNON_WORLD_X + vx * duration;
  return {
    durationSec: duration,
    vx,
    vy0,
    startX: CANNON_WORLD_X,
    startY: PLATFORM_Y,
    peakY,
    landingX,
  };
}

function posAtT(traj: Traj, t: number): [number, number] {
  // t in seconds since launch
  const x = traj.startX + traj.vx * t;
  const y = traj.startY + traj.vy0 * t + 0.5 * GRAVITY * t * t;
  return [x, y];
}

// Cosmetic ambient content ---------------------------------------------

function seedWeeds(): Weed[] {
  const out: Weed[] = [];
  // Weeds spread across the full world width so scrolling reveals more
  // of them. `x` is world coordinate.
  for (let i = 0; i < 18; i++) {
    out.push({ layer: 0, x: i * 180 + Math.random() * 80, w: 140 + Math.random() * 60, h: 60 + Math.random() * 50 });
  }
  for (let i = 0; i < 14; i++) {
    out.push({ layer: 1, x: i * 230 + Math.random() * 80, w: 180 + Math.random() * 60, h: 90 + Math.random() * 60 });
  }
  return out;
}

function seedBubbles(): Bubble[] {
  const out: Bubble[] = [];
  for (let i = 0; i < 36; i++) {
    out.push({
      x: Math.random() * 3600,
      y: Math.random() * (H - GROUND_H),
      r: 1.2 + Math.random() * 2.6,
      tw: Math.random() * Math.PI * 2,
      vy: 0.25 + Math.random() * 0.6,
    });
  }
  return out;
}

// Main component -------------------------------------------------------

export function CannonCanvas({ events, animating, onAnimDone, onMultiplierUpdate, angleDeg }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const startRef = useRef<number>(0);
  const doneRef = useRef(false);
  const hitSetRef = useRef<Set<number>>(new Set());
  const accumulatedBpsRef = useRef<number>(0);
  const splashesRef = useRef<Array<{ x: number; y: number; age: number; color: string }>>([]);
  const weedsRef = useRef<Weed[] | null>(null);
  const bubblesRef = useRef<Bubble[] | null>(null);
  const cameraXRef = useRef<number>(0);
  const frameRef = useRef<number>(0);

  const traj = useMemo(() => computeTrajectory(angleDeg, events), [angleDeg, events]);

  // Lay every event (blots + hazard) out along the arc at evenly-
  // spaced t positions. The hazard is no longer assumed to be terminal —
  // if it fires mid-sequence, the squid crashes at that t.
  const eventPlan = useMemo(() => {
    if (!events) {
      return { blots: [] as Array<{ t: number; worldX: number; worldY: number; value: number; index: number; ghost: boolean }>, hazard: null as null | { t: number; worldX: number; worldY: number; index: number } };
    }
    const totalSlots = events.length;
    let hazardIdx: number | null = null;
    for (let i = 0; i < events.length; i++) {
      if (events[i].kind === "hazard") {
        hazardIdx = i;
        break;
      }
    }
    const blots: Array<{ t: number; worldX: number; worldY: number; value: number; index: number; ghost: boolean }> = [];
    let hazard: null | { t: number; worldX: number; worldY: number; index: number } = null;
    for (let i = 0; i < events.length; i++) {
      const t = ((i + 1) / (totalSlots + 1)) * traj.durationSec;
      const [x, y] = posAtT(traj, t);
      const e = events[i];
      if (e.kind === "blot") {
        blots.push({
          t,
          worldX: x,
          worldY: y,
          value: e.value,
          index: i,
          // A blot past the hazard is a ghost — visible but never hit,
          // never adds to payout. Kept on the path so the arc still
          // looks populated.
          ghost: hazardIdx !== null && i > hazardIdx,
        });
      } else {
        hazard = { t, worldX: x, worldY: Math.min(y, GROUND_Y - 20), index: i };
      }
    }
    return { blots, hazard };
  }, [events, traj]);

  const blotPlan = eventPlan.blots;
  const hazardPos = eventPlan.hazard;

  // Reset per-run state.
  useEffect(() => {
    if (animating) {
      startRef.current = 0;
      doneRef.current = false;
      hitSetRef.current = new Set();
      accumulatedBpsRef.current = 0;
      splashesRef.current = [];
      if (onMultiplierUpdate) onMultiplierUpdate(0);
    }
  }, [animating, onMultiplierUpdate]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (!weedsRef.current) weedsRef.current = seedWeeds();
    if (!bubblesRef.current) bubblesRef.current = seedBubbles();

    let raf = 0;
    const draw = (now: number) => {
      frameRef.current++;
      const frame = frameRef.current;
      ctx.clearRect(0, 0, W, H);

      // ---------- Ocean sky gradient (same palette as flappy game) ----------
      const sky = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
      sky.addColorStop(0, "#7ad3e0");
      sky.addColorStop(0.25, "#2a9ac2");
      sky.addColorStop(0.6, "#0e4a7c");
      sky.addColorStop(1, "#041a3a");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, GROUND_Y);

      // Surface shimmer
      const shimmer = ctx.createLinearGradient(0, 0, 0, 40);
      shimmer.addColorStop(0, "rgba(255,255,255,0.35)");
      shimmer.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = shimmer;
      ctx.fillRect(0, 0, W, 40);

      // God-ray shafts (moving with camera for parallax)
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 6; i++) {
        const baseX = ((i * 160 + frame * 0.4 - cameraXRef.current * 0.15) % (W + 280)) - 120;
        ctx.fillStyle = "rgba(200, 230, 255, 0.05)";
        ctx.beginPath();
        ctx.moveTo(baseX, 0);
        ctx.lineTo(baseX + 50, 0);
        ctx.lineTo(baseX + 210, GROUND_Y);
        ctx.lineTo(baseX + 170, GROUND_Y);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();

      // ---------- Camera target ----------
      // Current squid position for camera follow. Squid coords are world space.
      let sx = traj.startX;
      let sy = traj.startY - 10;
      let rot = -((angleDeg * Math.PI) / 180) + Math.PI / 2;
      let speed = 0;
      // Squid physics end time — flight stops at hazard t (if any) or
      // at the full trajectory duration.
      const flightEndT = hazardPos ? hazardPos.t : traj.durationSec;

      if (events && animating) {
        if (startRef.current === 0) startRef.current = now;
        const elapsed = (now - startRef.current) / 1000;
        const t = Math.min(flightEndT, elapsed);
        const [x, y] = posAtT(traj, t);
        sx = x;
        sy = Math.min(y, GROUND_Y - 4);
        const dtEps = 0.016;
        const [x2, y2] = posAtT(traj, Math.min(flightEndT, t + dtEps));
        rot = Math.atan2(y2 - y, Math.max(1, x2 - x));
        speed = Math.hypot(x2 - x, y2 - y) / dtEps;

        // Collect only non-ghost blots, and only those whose t is
        // before or equal to the hazard (since ghost blots are beyond
        // the death point and unreachable).
        for (let i = 0; i < blotPlan.length; i++) {
          if (hitSetRef.current.has(i)) continue;
          const b = blotPlan[i];
          if (b.ghost) continue;
          if (elapsed >= b.t) {
            hitSetRef.current.add(i);
            accumulatedBpsRef.current += b.value;
            if (onMultiplierUpdate) onMultiplierUpdate(accumulatedBpsRef.current);
            splashesRef.current.push({
              x: b.worldX,
              y: b.worldY,
              age: 0,
              color: b.value > 3000 ? "#ffc24a" : b.value > 1000 ? "#c986ff" : "#5fd8ff",
            });
          }
        }

        if (elapsed >= flightEndT + LINGER_SECONDS && !doneRef.current) {
          doneRef.current = true;
          startRef.current = 0;
          onAnimDone();
        }
      } else if (events && !animating) {
        // Settled pose — squid at its final landing (hazard spot if it
        // died, else trajectory end).
        const [x, y] = posAtT(traj, flightEndT);
        sx = x; sy = Math.min(y, GROUND_Y - 4); rot = 0.6;
      }

      // Smoothly slide camera to keep the squid in the left third of
      // the viewport. When idle we sit over the cannon.
      const targetCamX = animating || (events && !animating)
        ? Math.max(0, sx - W * 0.3)
        : 0;
      cameraXRef.current += (targetCamX - cameraXRef.current) * 0.1;
      const camX = cameraXRef.current;

      // ---------- Ambient bubbles (world space) ----------
      ctx.save();
      ctx.translate(-camX, 0);
      const bubbles = bubblesRef.current!;
      for (const b of bubbles) {
        b.y -= b.vy;
        b.tw += 0.05;
        if (b.y < -4) {
          b.y = GROUND_Y + Math.random() * 20;
          b.x = camX + Math.random() * (W + 200);
        }
        const a = 0.35 + Math.sin(b.tw) * 0.15;
        ctx.strokeStyle = `rgba(220, 240, 255, ${a + 0.35})`;
        ctx.lineWidth = 1;
        ctx.fillStyle = `rgba(180, 220, 255, ${a * 0.35})`;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = `rgba(255,255,255,${a + 0.4})`;
        ctx.beginPath();
        ctx.arc(b.x - b.r * 0.4, b.y - b.r * 0.4, Math.max(0.6, b.r * 0.25), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // ---------- Weeds (world space, parallax per layer) ----------
      ctx.save();
      const weeds = weedsRef.current!;
      for (const h of weeds) {
        const parallax = h.layer === 0 ? 0.5 : 0.85;
        const screenX = h.x - camX * parallax;
        // Cull if fully off-screen
        if (screenX + h.w < -20 || screenX > W + 20) continue;
        const isFar = h.layer === 0;
        ctx.strokeStyle = isFar ? "rgba(25, 90, 80, 0.55)" : "rgba(10, 60, 45, 0.95)";
        ctx.lineWidth = isFar ? 3 : 5;
        ctx.lineCap = "round";
        const blades = isFar ? 3 : 4;
        for (let i = 0; i < blades; i++) {
          const bx = screenX + (i + 0.5) * (h.w / blades);
          const bladeH = h.h * 0.85;
          ctx.beginPath();
          ctx.moveTo(bx, GROUND_Y);
          const segs = 5;
          for (let s = 1; s <= segs; s++) {
            const t = s / segs;
            const wy = GROUND_Y - t * bladeH;
            const wx = bx + Math.sin(frame * 0.04 + i * 0.9 + h.x * 0.02 + t * 2) * 7 * t;
            ctx.lineTo(wx, wy);
          }
          ctx.stroke();
        }
      }
      ctx.restore();

      // ---------- Ground strip ----------
      ctx.fillStyle = "#0d1f3a";
      ctx.fillRect(0, GROUND_Y, W, GROUND_H);
      // Sand/rock top line
      ctx.fillStyle = "#8a6333";
      ctx.fillRect(0, GROUND_Y, W, 8);
      ctx.fillStyle = "#5f4220";
      for (let x = -((camX * 0.9) % 32); x < W; x += 32) {
        ctx.fillRect(x, GROUND_Y + 8, 16, 3);
      }

      // ---------- Blots along the trajectory ----------
      if (events) {
        for (let i = 0; i < blotPlan.length; i++) {
          if (hitSetRef.current.has(i) && animating) continue;
          const b = blotPlan[i];
          const screenX = b.worldX - camX;
          const screenY = b.worldY - 22 - Math.sin(frame * 0.1 + i) * 3;
          if (screenX < -40 || screenX > W + 40) continue;
          const size = 8 + Math.min(12, b.value / 400);
          // Ghost blots (past the hazard) are muted — visible as
          // "what could have been" but never collectable.
          if (b.ghost) {
            ctx.save();
            ctx.globalAlpha = 0.25;
          }
          const color = b.value > 3000 ? "#ffc24a" : b.value > 1000 ? "#c986ff" : "#5fd8ff";
          // Halo glow
          const halo = ctx.createRadialGradient(screenX, screenY, 2, screenX, screenY, size * 2.4);
          halo.addColorStop(0, color + "88");
          halo.addColorStop(1, color + "00");
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(screenX, screenY, size * 2.4, 0, Math.PI * 2);
          ctx.fill();
          // Droplet-shaped body (reuses the main game's droplet aesthetic)
          ctx.save();
          ctx.translate(screenX, screenY);
          const body = ctx.createRadialGradient(-3, -4, 1, 0, 0, size);
          body.addColorStop(0, color);
          body.addColorStop(0.6, adjustColor(color, -40));
          body.addColorStop(1, "#0a0224");
          ctx.fillStyle = body;
          ctx.beginPath();
          ctx.moveTo(0, -size * 1.25);
          ctx.bezierCurveTo(size * 1.05, -size * 0.2, size, size, 0, size);
          ctx.bezierCurveTo(-size, size, -size * 1.05, -size * 0.2, 0, -size * 1.25);
          ctx.fill();
          ctx.fillStyle = "rgba(255, 255, 255, 0.65)";
          ctx.beginPath();
          ctx.ellipse(-size * 0.3, -size * 0.3, size * 0.22, size * 0.38, -0.3, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          if (b.ghost) ctx.restore();
        }

        // Hazard — placed at whichever trajectory position the event
        // sequence locked in (can be mid-flight, not just terminal).
        // Rendered as a jagged underwater rock spike, the thing the
        // squid slams into and zeroes out on.
        if (hazardPos) {
          const hx = hazardPos.worldX - camX;
          const hy = hazardPos.worldY;
          if (hx > -60 && hx < W + 60) drawRock(ctx, hx, hy, now);
        }
      }

      // ---------- Splashes (world space) ----------
      for (let i = splashesRef.current.length - 1; i >= 0; i--) {
        const s = splashesRef.current[i];
        s.age += 1 / 60;
        if (s.age > 0.7) splashesRef.current.splice(i, 1);
      }
      ctx.save();
      ctx.translate(-camX, 0);
      for (const s of splashesRef.current) {
        const a = 1 - s.age / 0.7;
        ctx.fillStyle = s.color + Math.floor(a * 160).toString(16).padStart(2, "0");
        const r = 10 + s.age * 40;
        ctx.beginPath();
        ctx.arc(s.x, s.y - 22, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // ---------- Cannon (world space, on the left platform) ----------
      drawCannon(ctx, CANNON_WORLD_X - camX, PLATFORM_Y, angleDeg);

      // ---------- Squid ----------
      drawSquid(ctx, {
        x: sx - camX,
        y: sy,
        r: 12,
        rotRad: rot,
        flapPhase: speed * 0.01,
        frame,
      });

      // Preview arc deliberately removed — Moonsheep doesn't show
      // where the shot lands; the mystery is part of the draw.

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [events, animating, onAnimDone, onMultiplierUpdate, angleDeg, blotPlan, hazardPos, traj]);

  return (
    <div className="dive-canvas-wrap">
      <canvas ref={canvasRef} width={W} height={H} className="dive-canvas cannon2d-canvas" />
    </div>
  );
}

// ----- helpers ---------------------------------------------------------

function adjustColor(hex: string, delta: number): string {
  // Darken a #rrggbb color by `delta` (negative darkens, positive
  // lightens). Clamps to 0-255 per channel.
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 0xff;
  let g = (n >> 8) & 0xff;
  let b = n & 0xff;
  r = Math.max(0, Math.min(255, r + delta));
  g = Math.max(0, Math.min(255, g + delta));
  b = Math.max(0, Math.min(255, b + delta));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function drawCannon(ctx: CanvasRenderingContext2D, baseX: number, baseY: number, angleDeg: number) {
  const rotRad = -((angleDeg * Math.PI) / 180);
  ctx.save();
  ctx.translate(baseX, baseY);
  // Platform under the cannon
  ctx.fillStyle = "#2a1a40";
  ctx.beginPath();
  ctx.ellipse(0, 20, 52, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#4a2a68";
  ctx.beginPath();
  ctx.ellipse(0, 14, 50, 8, 0, 0, Math.PI);
  ctx.fill();
  // Carriage
  ctx.fillStyle = "#2a1a0c";
  ctx.fillRect(-26, -8, 52, 18);
  ctx.fillStyle = "#1a0f07";
  for (const wx of [-18, 18]) {
    ctx.beginPath(); ctx.arc(wx, 12, 9, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#3b2816"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(wx, 12, 9, 0, Math.PI * 2); ctx.stroke();
  }
  // Barrel
  ctx.save();
  ctx.rotate(rotRad);
  const barrelGrd = ctx.createLinearGradient(0, -9, 0, 9);
  barrelGrd.addColorStop(0, "#7e4f28");
  barrelGrd.addColorStop(0.5, "#4a2a13");
  barrelGrd.addColorStop(1, "#2a1708");
  ctx.fillStyle = barrelGrd;
  ctx.fillRect(0, -10, 50, 20);
  ctx.fillStyle = "#141414";
  for (const bx of [6, 22, 38]) ctx.fillRect(bx, -11, 3, 22);
  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(47, -12, 4, 24);
  ctx.restore();
  ctx.restore();
}

// Jagged underwater rock spike — the "you died on a rock" obstacle.
// Drawn with a dark stone gradient + glowing barnacle accents so it
// reads as menacing, not just clutter.
function drawRock(ctx: CanvasRenderingContext2D, x: number, y: number, now: number) {
  ctx.save();
  ctx.translate(x, y);
  // Base stone body
  const grd = ctx.createLinearGradient(0, -28, 0, 18);
  grd.addColorStop(0, "#3a3040");
  grd.addColorStop(0.6, "#1d1822");
  grd.addColorStop(1, "#0a0810");
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.moveTo(-20, 18);
  ctx.lineTo(-14, -6);
  ctx.lineTo(-6, 0);
  ctx.lineTo(-2, -22);
  ctx.lineTo(5, -10);
  ctx.lineTo(10, -28);
  ctx.lineTo(16, -8);
  ctx.lineTo(22, 4);
  ctx.lineTo(20, 18);
  ctx.closePath();
  ctx.fill();
  // Lower shadow
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.beginPath();
  ctx.ellipse(2, 20, 22, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  // Glowing barnacles / crystals so the rock feels alive
  const pulse = 0.6 + Math.sin(now / 300) * 0.4;
  ctx.fillStyle = `rgba(255, 130, 180, ${0.55 + pulse * 0.2})`;
  ctx.beginPath();
  ctx.arc(-8, -4, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(6, -14, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = `rgba(110, 220, 255, ${0.45 + pulse * 0.25})`;
  ctx.beginPath();
  ctx.arc(14, -2, 1.8, 0, Math.PI * 2);
  ctx.fill();
  // Jagged outline highlights
  ctx.strokeStyle = "rgba(200, 180, 220, 0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-14, -6);
  ctx.lineTo(-2, -22);
  ctx.lineTo(10, -28);
  ctx.lineTo(16, -8);
  ctx.stroke();
  ctx.restore();
}

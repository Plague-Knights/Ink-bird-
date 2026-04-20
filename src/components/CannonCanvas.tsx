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
  // User-selected launch angle in degrees, 20..80.
  angleDeg: number;
};

// Portrait canvas to match Moonsheep's mobile-first layout. All gameplay
// happens vertically: cannon at the lower-left, scene fills up toward the
// sky, squid arcs upward into the flight area where blots + hazards live.
const W = 480;
const H = 760;

// Platform positions — cannon sits on the left rock, spectator (a small
// sibling squid friend) sits on the right rock. Kept on-screen at all
// times so the frame reads as a character sketch, not an empty level.
const CANNON_X = 100;
const PLATFORM_Y = H - 130;
const SPECTATOR_X = W - 80;

// Flight area top (where the "moon" hangs) and bottom (cannon mouth).
// Arc traverses from bottom to top depending on angle.
const FLIGHT_TOP_Y = 110;

const FLIGHT_SECONDS_PER_BLOT = 0.3;
const LINGER_SECONDS = 1.0;

function blotCount(events: readonly CannonEvent[] | null): number {
  if (!events) return 0;
  let n = 0;
  for (const e of events) if (e.kind === "blot") n++;
  return n;
}

function hasHazard(events: readonly CannonEvent[] | null): boolean {
  return events?.some((e) => e.kind === "hazard") ?? false;
}

// Given a launch angle in degrees (measured from horizontal), produce an
// arc ending roughly up and to the right of the cannon. Steeper angle
// pushes the endpoint higher but less to the right. Flat angle pushes
// endpoint farther to the right.
function arcEnd(angleDeg: number): { x: number; y: number; peakH: number } {
  const a = (angleDeg * Math.PI) / 180;
  // Max reach scales with sin(2a) for projectile; we keep a fixed
  // "power" and let angle redistribute between horizontal & vertical
  // reach so the trajectory always fits the canvas.
  const powerX = 300; // px
  const powerY = 520; // px
  const ex = CANNON_X + Math.cos(a) * powerX;
  const ey = PLATFORM_Y - 20 - Math.sin(a) * powerY;
  const peakH = Math.max(60, Math.sin(a) * powerY * 0.6 + 40);
  return { x: Math.min(W - 40, ex), y: Math.max(FLIGHT_TOP_Y, ey), peakH };
}

function arcPoint(t: number, angleDeg: number): [number, number] {
  const { x: ex, y: ey, peakH } = arcEnd(angleDeg);
  const startX = CANNON_X;
  const startY = PLATFORM_Y - 20;
  const x = startX + t * (ex - startX);
  const parabola = 4 * peakH * t * (1 - t);
  const linearY = startY + t * (ey - startY);
  return [x, linearY - parabola];
}

export function CannonCanvas({ events, animating, onAnimDone, onMultiplierUpdate, angleDeg }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const startRef = useRef<number>(0);
  const doneRef = useRef(false);
  const bubblesRef = useRef<Array<{ x: number; y: number; vy: number; r: number; life: number }>>([]);
  const starsRef = useRef<Array<{ x: number; y: number; r: number; tw: number }> | null>(null);
  const hitSetRef = useRef<Set<number>>(new Set());
  const accumulatedBpsRef = useRef<number>(0);
  const inkSplashesRef = useRef<Array<{ x: number; y: number; age: number; color: string }>>([]);

  const blotPlan = useMemo(() => {
    if (!events) return [] as Array<{ t: number; value: number }>;
    const blots = events.filter((e) => e.kind === "blot") as Array<{ kind: "blot"; value: number }>;
    const total = blots.length;
    return blots.map((b, i) => ({
      t: (i + 1) / (total + 1),
      value: b.value,
    }));
  }, [events]);

  const flightSeconds = useMemo(() => {
    if (!events) return 1.2;
    return Math.max(1.4, blotCount(events) * FLIGHT_SECONDS_PER_BLOT + 0.8);
  }, [events]);

  // Reset per-run state every time a new animation starts.
  useEffect(() => {
    if (animating) {
      startRef.current = 0;
      doneRef.current = false;
      hitSetRef.current = new Set();
      accumulatedBpsRef.current = 0;
      inkSplashesRef.current = [];
      if (onMultiplierUpdate) onMultiplierUpdate(0);
    }
  }, [animating, onMultiplierUpdate]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Seed starfield once. Stationary, twinkles in place.
    if (!starsRef.current) {
      const arr: Array<{ x: number; y: number; r: number; tw: number }> = [];
      for (let i = 0; i < 60; i++) {
        arr.push({
          x: Math.random() * W,
          y: Math.random() * (FLIGHT_TOP_Y + 180),
          r: 0.6 + Math.random() * 1.4,
          tw: Math.random() * Math.PI * 2,
        });
      }
      starsRef.current = arr;
    }

    let raf = 0;
    const draw = (now: number) => {
      ctx.clearRect(0, 0, W, H);

      // --- Sky / deep space gradient ---
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, "#120a2c");
      sky.addColorStop(0.25, "#1c1344");
      sky.addColorStop(0.55, "#1b2f64");
      sky.addColorStop(0.8, "#0d3a6a");
      sky.addColorStop(1, "#010716");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);

      // --- Starfield (twinkling) ---
      for (const s of starsRef.current!) {
        s.tw += 0.03;
        const a = 0.4 + Math.sin(s.tw) * 0.4;
        ctx.fillStyle = `rgba(220, 230, 255, ${a.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // --- Floating "moon" / target orb in the upper-right ---
      drawMoon(ctx, W - 120, 130, 60, now);

      // --- Distant mountain silhouettes (mid-ground) ---
      ctx.fillStyle = "#1a0e42";
      ctx.beginPath();
      ctx.moveTo(0, H * 0.6);
      for (let x = 0; x <= W; x += 10) {
        const y = H * 0.6 - Math.sin(x / 70) * 22 - Math.sin(x / 30) * 8;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, H); ctx.lineTo(0, H);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#2a1158";
      ctx.beginPath();
      ctx.moveTo(0, H * 0.7);
      for (let x = 0; x <= W; x += 10) {
        const y = H * 0.7 - Math.sin((x + 20) / 50) * 18 - 6;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, H); ctx.lineTo(0, H);
      ctx.closePath();
      ctx.fill();

      // --- Drifting ambient bubbles through the whole scene ---
      if (Math.random() < 0.04) {
        bubblesRef.current.push({
          x: Math.random() * W,
          y: H + 4,
          vy: -0.25 - Math.random() * 0.3,
          r: 1 + Math.random() * 2.5,
          life: 0,
        });
      }
      for (let i = bubblesRef.current.length - 1; i >= 0; i--) {
        const b = bubblesRef.current[i];
        b.y += b.vy;
        b.life += 1 / 60;
        if (b.y < 60 || b.life > 18) bubblesRef.current.splice(i, 1);
      }
      ctx.fillStyle = "rgba(200,230,255,0.5)";
      for (const b of bubblesRef.current) {
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // --- Left platform with cannon + squid ---
      drawPlatform(ctx, CANNON_X, PLATFORM_Y + 30, 110, "#3a1a72");
      drawCannon(ctx, CANNON_X, PLATFORM_Y, angleDeg);

      // --- Right platform with spectator ---
      drawPlatform(ctx, SPECTATOR_X, PLATFORM_Y + 30, 80, "#2a1558");
      drawSpectator(ctx, SPECTATOR_X, PLATFORM_Y - 20, now);

      // --- Trajectory preview when idle (dotted path showing where squid will go) ---
      if (!events || (!animating && !hasHazard(events))) {
        drawPreviewArc(ctx, angleDeg, now);
      }

      // --- Blots on the arc (only shown while / after a run) ---
      if (events) {
        const total = blotCount(events);
        let bi = 0;
        for (const e of events) {
          if (e.kind !== "blot") continue;
          bi++;
          if (hitSetRef.current.has(bi - 1) && animating) continue;
          const t = bi / (total + 1);
          const [bx, by] = arcPoint(t, angleDeg);
          const size = 5 + Math.min(10, e.value / 400);
          const color = e.value > 3000 ? "#ffc24a" : e.value > 1000 ? "#c986ff" : "#5fd8ff";
          ctx.fillStyle = color + "55";
          ctx.beginPath();
          ctx.arc(bx, by, size + 3 + Math.sin(now / 200 + bi) * 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(bx, by, size, 0, Math.PI * 2);
          ctx.fill();
        }
        // Hazard at arc end
        if (hasHazard(events)) {
          const [hx, hy] = arcPoint(1, angleDeg);
          drawAnglerfish(ctx, hx, hy, now);
        }
      }

      // --- Squid position: either in-cannon (idle) or mid-flight ---
      let sx = CANNON_X + Math.cos((angleDeg * Math.PI) / 180) * 30;
      let sy = PLATFORM_Y - 30 - Math.sin((angleDeg * Math.PI) / 180) * 30;
      let rot = -((angleDeg * Math.PI) / 180) + Math.PI / 2;
      let squidSpeed = 0;

      if (events && animating) {
        if (startRef.current === 0) startRef.current = now;
        const elapsed = (now - startRef.current) / 1000;
        const t = Math.min(1, elapsed / flightSeconds);
        const [x, y] = arcPoint(t, angleDeg);
        sx = x; sy = y;
        const dt = 0.01;
        const [x2, y2] = arcPoint(Math.min(1, t + dt), angleDeg);
        rot = Math.atan2(y2 - y, Math.max(1, x2 - x));
        squidSpeed = Math.hypot(x2 - x, y2 - y);

        for (let i = 0; i < blotPlan.length; i++) {
          if (hitSetRef.current.has(i)) continue;
          if (t >= blotPlan[i].t) {
            hitSetRef.current.add(i);
            accumulatedBpsRef.current += blotPlan[i].value;
            if (onMultiplierUpdate) onMultiplierUpdate(accumulatedBpsRef.current);
            const [hx, hy] = arcPoint(blotPlan[i].t, angleDeg);
            inkSplashesRef.current.push({
              x: hx, y: hy, age: 0,
              color: blotPlan[i].value > 3000 ? "#ffc24a" : blotPlan[i].value > 1000 ? "#c986ff" : "#5fd8ff",
            });
          }
        }

        if (t >= 1 && elapsed >= flightSeconds + LINGER_SECONDS && !doneRef.current) {
          doneRef.current = true;
          startRef.current = 0;
          onAnimDone();
        }
      } else if (events && !animating) {
        const [x, y] = arcPoint(1, angleDeg);
        sx = x; sy = y; rot = 0.6;
      }

      // --- Ink splashes (fade out) ---
      for (let i = inkSplashesRef.current.length - 1; i >= 0; i--) {
        const s = inkSplashesRef.current[i];
        s.age += 1 / 60;
        if (s.age > 0.7) inkSplashesRef.current.splice(i, 1);
      }
      for (const s of inkSplashesRef.current) {
        const a = 1 - s.age / 0.7;
        ctx.fillStyle = s.color + Math.floor(a * 160).toString(16).padStart(2, "0");
        const r = 10 + s.age * 40;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
        ctx.fill();
      }

      // --- Squid body ---
      drawSquid(ctx, {
        x: sx,
        y: sy,
        r: 12,
        rotRad: rot,
        flapPhase: squidSpeed * 0.3,
        frame: Math.floor(now / 16.67),
      });

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [events, animating, onAnimDone, onMultiplierUpdate, angleDeg, blotPlan, flightSeconds]);

  return (
    <div className="dive-canvas-wrap">
      <canvas ref={canvasRef} width={W} height={H} className="dive-canvas cannon2d-canvas" />
    </div>
  );
}

// ----- helpers ---------------------------------------------------------

function drawMoon(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, now: number) {
  const glow = ctx.createRadialGradient(x, y, r * 0.3, x, y, r * 1.8);
  glow.addColorStop(0, "rgba(180, 220, 255, 0.25)");
  glow.addColorStop(1, "rgba(180, 220, 255, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, r * 1.8, 0, Math.PI * 2);
  ctx.fill();
  // Base orb — tealish planet
  const body = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
  body.addColorStop(0, "#9cf0ff");
  body.addColorStop(0.6, "#4ba3c7");
  body.addColorStop(1, "#1a4868");
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  // Ink-blot continents
  ctx.fillStyle = "rgba(30, 80, 60, 0.55)";
  ctx.beginPath();
  ctx.ellipse(x - 8 + Math.sin(now / 3000) * 2, y - 10, r * 0.35, r * 0.22, 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x + 14, y + 18, r * 0.25, r * 0.18, -0.3, 0, Math.PI * 2);
  ctx.fill();
}

function drawPlatform(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(cx, cy, w * 0.55, 18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(160, 120, 255, 0.4)";
  ctx.beginPath();
  ctx.ellipse(cx, cy - 6, w * 0.55, 10, 0, 0, Math.PI);
  ctx.fill();
  // Rocky rim highlights
  ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(cx, cy - 2, w * 0.5, 14, 0, Math.PI, 2 * Math.PI);
  ctx.stroke();
}

function drawCannon(ctx: CanvasRenderingContext2D, baseX: number, baseY: number, angleDeg: number) {
  const rotRad = -((angleDeg * Math.PI) / 180);
  ctx.save();
  ctx.translate(baseX, baseY);
  // Carriage — small wooden box
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

// Small jellyfish-ish spectator that bobs next to the cannon — the
// "second character on the neighbor platform" vibe from Moonsheep.
function drawSpectator(ctx: CanvasRenderingContext2D, x: number, y: number, now: number) {
  ctx.save();
  const bob = Math.sin(now / 500) * 3;
  ctx.translate(x, y + bob);
  // Bell
  const g = ctx.createRadialGradient(0, -4, 2, 0, -4, 18);
  g.addColorStop(0, "rgba(168, 232, 255, 0.9)");
  g.addColorStop(1, "rgba(70, 130, 200, 0.6)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, -6, 16, 12, 0, Math.PI, 2 * Math.PI);
  ctx.fill();
  ctx.strokeStyle = "rgba(200, 240, 255, 0.8)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(0, -6, 16, 12, 0, Math.PI, 2 * Math.PI);
  ctx.stroke();
  // Eyes
  ctx.fillStyle = "#000";
  ctx.beginPath(); ctx.arc(-4, -8, 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(4, -8, 1.5, 0, Math.PI * 2); ctx.fill();
  // Tentacles
  ctx.strokeStyle = "rgba(168, 232, 255, 0.7)";
  ctx.lineWidth = 1.8;
  for (let i = 0; i < 5; i++) {
    const tx = -12 + i * 6;
    ctx.beginPath();
    ctx.moveTo(tx, -6);
    ctx.quadraticCurveTo(tx, 4 + Math.sin(now / 200 + i) * 2, tx + Math.sin(now / 180 + i) * 2, 14);
    ctx.stroke();
  }
  ctx.restore();
}

// Dotted preview arc shown while idle — tells the player where the shot
// will land before they commit. Dots advance with time so the arc reads
// as a flight path, not a static curve.
function drawPreviewArc(ctx: CanvasRenderingContext2D, angleDeg: number, now: number) {
  const steps = 24;
  const phase = (now / 60) % 1;
  ctx.fillStyle = "rgba(255, 240, 160, 0.6)";
  for (let i = 0; i < steps; i++) {
    const t = (i + phase) / steps;
    if (t > 1) continue;
    const [x, y] = arcPoint(t, angleDeg);
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawAnglerfish(ctx: CanvasRenderingContext2D, x: number, y: number, now: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "#0a1530";
  ctx.beginPath();
  ctx.ellipse(0, 0, 26, 18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.moveTo(-22 + i * 7, 0);
    ctx.lineTo(-19 + i * 7, 5);
    ctx.lineTo(-16 + i * 7, 0);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = "#fff";
  ctx.beginPath(); ctx.arc(-4, -4, 3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#000";
  ctx.beginPath(); ctx.arc(-3.5, -4, 1.6, 0, Math.PI * 2); ctx.fill();
  const lureX = -30 + Math.sin(now / 300) * 3;
  const lureY = -18 + Math.cos(now / 300) * 3;
  ctx.strokeStyle = "#555";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-20, -6);
  ctx.quadraticCurveTo(-26, -14, lureX, lureY);
  ctx.stroke();
  const lureGrad = ctx.createRadialGradient(lureX, lureY, 1, lureX, lureY, 10);
  lureGrad.addColorStop(0, "#fff8c0");
  lureGrad.addColorStop(1, "rgba(255,230,100,0)");
  ctx.fillStyle = lureGrad;
  ctx.beginPath();
  ctx.arc(lureX, lureY, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffe060";
  ctx.beginPath();
  ctx.arc(lureX, lureY, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

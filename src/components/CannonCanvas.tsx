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
  // 0 = low / flat (15°), 1 = mid (45°), 2 = high / steep (75°)
  // Cosmetic for now — angle changes the arc height and duration so the
  // shot feels different, but the outcome (event sequence) is still
  // determined by the server's commit-reveal.
  angle?: 0 | 1 | 2;
};

const W = 480;
const H = 560;

// Horizontal arc: squid flies left to right. Cannon anchored at the
// lower-left. Endpoint and height vary with the angle tier.
const LAUNCH_X = 40;
const LAUNCH_Y = H * 0.78;
const END_X = W - 60;

function arcEnd(angle: 0 | 1 | 2): { x: number; y: number; peakH: number } {
  switch (angle) {
    case 0: return { x: END_X, y: LAUNCH_Y - 30,  peakH: 90  }; // flat
    case 1: return { x: END_X, y: LAUNCH_Y - 80,  peakH: 180 }; // mid
    case 2: return { x: END_X, y: LAUNCH_Y - 140, peakH: 260 }; // steep
  }
}

function arcPoint(t: number, angle: 0 | 1 | 2): [number, number] {
  const { x: ex, y: ey, peakH } = arcEnd(angle);
  const x = LAUNCH_X + t * (ex - LAUNCH_X);
  // Parabola: y dips up at peak then lands near ey. 4h*t*(1-t) is the
  // standard normalized parabola.
  const parabola = 4 * peakH * t * (1 - t);
  const landingDip = (LAUNCH_Y - ey) * t;
  const y = LAUNCH_Y - parabola - landingDip;
  return [x, y];
}

function blotCount(events: readonly CannonEvent[] | null): number {
  if (!events) return 0;
  let n = 0;
  for (const e of events) if (e.kind === "blot") n++;
  return n;
}

function hasHazard(events: readonly CannonEvent[] | null): boolean {
  if (!events) return false;
  return events.some((e) => e.kind === "hazard");
}

const FLIGHT_SECONDS_PER_BLOT = 0.32;
const LINGER_SECONDS = 0.9;

export function CannonCanvas({ events, animating, onAnimDone, onMultiplierUpdate, angle = 1 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const startRef = useRef<number>(0);
  const doneRef = useRef(false);
  const bubblesRef = useRef<Array<{ x: number; y: number; vy: number; r: number; life: number }>>([]);
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
    if (!events) return 1;
    return Math.max(1.4, blotCount(events) * FLIGHT_SECONDS_PER_BLOT + 0.8);
  }, [events]);

  useEffect(() => {
    if (animating) {
      startRef.current = 0;
      doneRef.current = false;
      hitSetRef.current = new Set();
      accumulatedBpsRef.current = 0;
      inkSplashesRef.current = [];
      bubblesRef.current = [];
      if (onMultiplierUpdate) onMultiplierUpdate(0);
    }
  }, [animating, onMultiplierUpdate]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    const draw = (now: number) => {
      ctx.clearRect(0, 0, W, H);

      // Ocean / sky gradient backdrop
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, "#1b3b66");
      sky.addColorStop(0.4, "#0c2a54");
      sky.addColorStop(0.75, "#061f4a");
      sky.addColorStop(1, "#020716");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);

      // Water surface line — same style as the main game
      ctx.strokeStyle = "rgba(200,230,255,0.25)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 4) {
        const y = LAUNCH_Y + 18 + Math.sin((x + now / 50) / 22) * 2;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Drifting ambient bubbles (not the dive trail — separate slow flow)
      if (Math.random() < 0.03) {
        bubblesRef.current.push({
          x: Math.random() * W,
          y: H + 4,
          vy: -0.2 - Math.random() * 0.3,
          r: 1 + Math.random() * 2,
          life: 0,
        });
      }
      for (let i = bubblesRef.current.length - 1; i >= 0; i--) {
        const b = bubblesRef.current[i];
        b.y += b.vy;
        b.life += 1 / 60;
        if (b.y < 40 || b.life > 15) bubblesRef.current.splice(i, 1);
      }
      ctx.fillStyle = "rgba(200,230,255,0.5)";
      for (const b of bubblesRef.current) {
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Cannon (procedural) — drawn after background, before projectile.
      drawCannon(ctx, LAUNCH_X - 18, LAUNCH_Y + 12, angleRadians(angle));

      // Blots along the arc
      if (events) {
        const total = blotCount(events);
        let bi = 0;
        for (const e of events) {
          if (e.kind !== "blot") continue;
          bi++;
          const t = bi / (total + 1);
          const [bx, by] = arcPoint(t, angle);
          const alreadyHit = hitSetRef.current.has(bi - 1);
          if (alreadyHit) continue;
          const size = 5 + Math.min(10, e.value / 400);
          const color = e.value > 3000 ? "#ffc24a" : e.value > 1000 ? "#c986ff" : "#5fd8ff";
          // Pulsing halo
          ctx.fillStyle = color + "55";
          ctx.beginPath();
          ctx.arc(bx, by, size + 3 + Math.sin(now / 200 + bi) * 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(bx, by, size, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Hazard at the arc terminus (anglerfish silhouette) if this round ends on one
      if (events && hasHazard(events)) {
        const [hx, hy] = arcPoint(1, angle);
        drawAnglerfish(ctx, hx, hy, now);
      }

      // Squid position
      let sx = LAUNCH_X;
      let sy = LAUNCH_Y;
      let rot = 0;
      let squidSpeed = 0;
      if (events && animating) {
        if (startRef.current === 0) startRef.current = now;
        const elapsed = (now - startRef.current) / 1000;
        const t = Math.min(1, elapsed / flightSeconds);
        const [x, y] = arcPoint(t, angle);
        sx = x;
        sy = y;
        // Derivative of the parabola for rotation
        const dt = 0.01;
        const [x2, y2] = arcPoint(Math.min(1, t + dt), angle);
        rot = Math.atan2(y2 - y, Math.max(1, x2 - x));
        squidSpeed = Math.hypot(x2 - x, y2 - y);

        // Blot hits
        const blots = blotPlan;
        for (let i = 0; i < blots.length; i++) {
          if (hitSetRef.current.has(i)) continue;
          if (t >= blots[i].t) {
            hitSetRef.current.add(i);
            accumulatedBpsRef.current += blots[i].value;
            if (onMultiplierUpdate) onMultiplierUpdate(accumulatedBpsRef.current);
            const [hx, hy] = arcPoint(blots[i].t, angle);
            inkSplashesRef.current.push({
              x: hx, y: hy, age: 0,
              color: blots[i].value > 3000 ? "#ffc24a" : blots[i].value > 1000 ? "#c986ff" : "#5fd8ff",
            });
          }
        }

        if (t >= 1 && elapsed >= flightSeconds + LINGER_SECONDS && !doneRef.current) {
          doneRef.current = true;
          startRef.current = 0;
          onAnimDone();
        }
      } else if (events && !animating) {
        // Settled: show squid at arc end
        const [x, y] = arcPoint(1, angle);
        sx = x; sy = y;
        rot = 0.6;
      }

      // Ink splashes (fade out over ~0.6s)
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

      // Squid
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
  }, [events, animating, onAnimDone, onMultiplierUpdate, angle, blotPlan, flightSeconds]);

  return (
    <div className="dive-canvas-wrap">
      <canvas ref={canvasRef} width={W} height={H} className="dive-canvas cannon2d-canvas" />
    </div>
  );
}

function angleRadians(a: 0 | 1 | 2): number {
  // Cannon barrel rotation. Low angle = mostly horizontal, high = steep.
  return [-Math.PI / 12, -Math.PI / 4, -Math.PI / 2.3][a];
}

function drawCannon(ctx: CanvasRenderingContext2D, baseX: number, baseY: number, rotRad: number) {
  ctx.save();
  ctx.translate(baseX, baseY);
  // Carriage
  ctx.fillStyle = "#2a1a0c";
  ctx.fillRect(-30, -6, 60, 14);
  // Wheels
  ctx.fillStyle = "#1a0f07";
  for (const wx of [-22, 22]) {
    ctx.beginPath(); ctx.arc(wx, 12, 10, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#3b2816"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(wx, 12, 10, 0, Math.PI * 2); ctx.stroke();
  }
  // Barrel (rotated)
  ctx.save();
  ctx.rotate(rotRad);
  const barrelGrd = ctx.createLinearGradient(0, -9, 0, 9);
  barrelGrd.addColorStop(0, "#6e4423");
  barrelGrd.addColorStop(0.5, "#4a2a13");
  barrelGrd.addColorStop(1, "#2a1708");
  ctx.fillStyle = barrelGrd;
  ctx.fillRect(0, -9, 55, 18);
  // Iron bands
  ctx.fillStyle = "#141414";
  for (const bx of [8, 26, 44]) ctx.fillRect(bx, -10, 3, 20);
  // Muzzle ring
  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(52, -11, 4, 22);
  ctx.restore();
  ctx.restore();
}

function drawAnglerfish(ctx: CanvasRenderingContext2D, x: number, y: number, now: number) {
  ctx.save();
  ctx.translate(x, y);
  // Body — rounded, dark navy
  ctx.fillStyle = "#0a1530";
  ctx.beginPath();
  ctx.ellipse(0, 0, 26, 18, 0, 0, Math.PI * 2);
  ctx.fill();
  // Jagged teeth mouth
  ctx.fillStyle = "#1b2a48";
  ctx.beginPath();
  ctx.moveTo(-24, -2);
  for (let i = 0; i < 6; i++) {
    ctx.lineTo(-24 + i * 6, (i % 2 === 0) ? 3 : -2);
  }
  ctx.lineTo(6, 5);
  ctx.lineTo(-24, 6);
  ctx.closePath();
  ctx.fill();
  // Teeth
  ctx.fillStyle = "#fff";
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.moveTo(-22 + i * 7, 0);
    ctx.lineTo(-19 + i * 7, 5);
    ctx.lineTo(-16 + i * 7, 0);
    ctx.closePath();
    ctx.fill();
  }
  // Eye
  ctx.fillStyle = "#fff";
  ctx.beginPath(); ctx.arc(-4, -4, 3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#000";
  ctx.beginPath(); ctx.arc(-3.5, -4, 1.6, 0, Math.PI * 2); ctx.fill();
  // Glowing lure
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

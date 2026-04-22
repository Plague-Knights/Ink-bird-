"use client";

import { useEffect, useRef } from "react";
import {
  initialState, step, type SimState,
  W, H, GROUND_H,
} from "@/lib/simulate";
import { drawPipe, drawBird, drawChest, drawDroplet, collectibleForPos } from "@/lib/gameArt";
import { planAutoFlapper, type AutoPlan } from "@/lib/autoFlapper";

const STEP_MS = 1000 / 60;
const MAX_FRAME_MS = 250;
const POST_DEATH_MS = 2400;

function rand(a: number, b: number) { return a + Math.random() * (b - a); }

type Particle = {
  x: number; y: number; vx: number; vy: number;
  life: number; max: number; r: number;
  color: string; kind: "puff" | "splash"; g?: number;
};
type TrailDot = { x: number; y: number; r: number; life: number };
type Bubble = { x: number; y: number; r: number; tw: number; vy: number };
type Weed = { layer: 0 | 1; x: number; w: number; h: number };

// Three-tier speed. "off" runs the sim at 60hz real time; "on" runs
// 3 sim ticks per real tick (~3x); "super" runs 7 sim ticks per real
// tick (~7x) for players who just want outcomes fast.
export type TurboLevel = "off" | "on" | "super";

type Props = {
  seed?: number; // optional fixed seed for reproducible runs
  turbo?: TurboLevel;
  // When true, draws a "DEMO" badge over the canvas so players know
  // what they're watching isn't their own round yet. The parent flips
  // this off while a real on-chain round is in flight.
  demo?: boolean;
  // When true, the run stops permanently on bird death instead of
  // auto-restarting. Parent uses this to freeze the scene while the
  // chest-reveal overlay plays out.
  holdOnDeath?: boolean;
  // Called once per run when the bird dies, with the chests-only
  // collection count (droplets excluded). Parent uses this to size
  // the reveal sequence.
  onRunEnd?: (chestsCollected: number) => void;
};

export function AutoFlapper({
  seed: fixedSeed,
  turbo = "off",
  demo = false,
  holdOnDeath = false,
  onRunEnd,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef  = useRef<SimState | null>(null);
  const planRef   = useRef<AutoPlan | null>(null);
  const flapPhaseRef = useRef(0);
  const birdRotRef = useRef(0);
  const groundXRef = useRef(0);
  const frameClockRef = useRef(0);
  const deadSinceRef = useRef<number | null>(null);
  const seedRef = useRef<number>(fixedSeed ?? Math.floor(Math.random() * 0xffffffff));

  const particlesRef = useRef<Particle[]>([]);
  const trailRef = useRef<TrailDot[]>([]);
  const bubblesRef = useRef<Bubble[]>([]);
  const weedsRef = useRef<Weed[]>([]);
  const collectedSetRef = useRef<WeakSet<object>>(new WeakSet());

  // Stats live in a ref so render() inside the RAF loop always reads
  // the latest values. useState doesn't work here — render is closed
  // over the initial state and never sees setState updates.
  const statsRef = useRef({ pipesPassed: 0, droplets: 0, run: 1 });
  const turboRef = useRef(turbo);
  useEffect(() => { turboRef.current = turbo; }, [turbo]);
  const demoRef = useRef(demo);
  useEffect(() => { demoRef.current = demo; }, [demo]);
  const holdOnDeathRef = useRef(holdOnDeath);
  useEffect(() => { holdOnDeathRef.current = holdOnDeath; }, [holdOnDeath]);
  const onRunEndRef = useRef(onRunEnd);
  useEffect(() => { onRunEndRef.current = onRunEnd; }, [onRunEnd]);
  // Chest-only collection counter — resets each new run.
  const chestsCollectedRef = useRef(0);
  const runEndFiredRef = useRef(false);

  function initParallax() {
    const bubbles: Bubble[] = [];
    for (let i = 0; i < 36; i++) {
      bubbles.push({
        x: Math.random() * W,
        y: Math.random() * (H - GROUND_H),
        r: rand(1.2, 3.2),
        tw: Math.random() * Math.PI * 2,
        vy: rand(0.3, 0.9),
      });
    }
    const weeds: Weed[] = [];
    for (let i = 0; i < 6; i++) weeds.push({ layer: 0, x: i * 120, w: rand(120, 180), h: rand(60, 110) });
    for (let i = 0; i < 6; i++) weeds.push({ layer: 1, x: i * 160, w: rand(160, 220), h: rand(90, 150) });
    bubblesRef.current = bubbles;
    weedsRef.current = weeds;
  }

  function startNewRun() {
    const seed = fixedSeed ?? Math.floor(Math.random() * 0xffffffff);
    seedRef.current = seed;
    const plan = planAutoFlapper(seed);
    planRef.current = plan;
    stateRef.current = initialState(seed);
    flapPhaseRef.current = 0;
    birdRotRef.current = 0;
    deadSinceRef.current = null;
    particlesRef.current = [];
    trailRef.current = [];
    collectedSetRef.current = new WeakSet();
    chestsCollectedRef.current = 0;
    runEndFiredRef.current = false;
  }

  useEffect(() => {
    initParallax();
    startNewRun();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let acc = 0;
    let last = performance.now();

    const loop = (now: number) => {
      const dt = Math.min(now - last, MAX_FRAME_MS);
      last = now;
      acc += dt;

      // Turbo runs the simulation multiple ticks per real tick. Same
      // logic either way — doesn't affect correctness or seed
      // determinism since the plan is pre-computed. "super" pushes
      // through a round in a second or two.
      const tLevel = turboRef.current;
      const stepsPerTick = tLevel === "super" ? 7 : tLevel === "on" ? 3 : 1;

      while (acc >= STEP_MS) {
        acc -= STEP_MS;
        for (let _t = 0; _t < stepsPerTick; _t++) {
        const s = stateRef.current;
        const plan = planRef.current;
        if (!s || !plan) break;

        if (!s.dead) {
          const flapping = plan.inputs.some(i => i.f === s.frame);
          if (flapping) {
            flapPhaseRef.current = 0;
            for (let i = 0; i < 4; i++) {
              particlesRef.current.push({
                x: s.bird.x - 10 + rand(-3, 3),
                y: s.bird.y + rand(-4, 4),
                vx: rand(-2, -0.5), vy: rand(-1.4, 1.4),
                life: 24, max: 24, r: rand(2, 4),
                color: "rgba(220,240,255,1)", kind: "puff",
              });
            }
          }
          const beforeCollected = new Set(s.droplets.filter(d => d.collected));
          step(s, plan.inputs);
          flapPhaseRef.current += 1;

          for (const d of s.droplets) {
            if (d.collected && !beforeCollected.has(d) && !collectedSetRef.current.has(d)) {
              collectedSetRef.current.add(d);
              const c = collectibleForPos(d.x, d.y);
              if (c.kind === "chest") chestsCollectedRef.current += 1;
              const color = c.kind === "drop"
                ? "rgba(180,140,255,1)"
                : c.tier === 3 ? "rgba(127,227,255,1)"
                : c.tier === 2 ? "rgba(255,215,106,1)"
                : c.tier === 1 ? "rgba(207,216,220,1)"
                :                "rgba(255,180,100,1)";
              const count = c.kind === "chest" && c.tier >= 2 ? 24 : c.kind === "chest" ? 14 : 10;
              for (let i = 0; i < count; i++) {
                particlesRef.current.push({
                  x: d.x, y: d.y,
                  vx: rand(-3.5, 3.5), vy: rand(-4, -0.5),
                  life: 36, max: 36, r: rand(1.5, 3.2),
                  color, kind: "splash", g: 0.18,
                });
              }
            }
          }

          if (s.frame % 2 === 0) {
            trailRef.current.push({ x: s.bird.x - 6, y: s.bird.y, r: 6, life: 30 });
          }

          const targetRot = Math.max(-0.7, Math.min(1.2, s.bird.vy * 0.08));
          birdRotRef.current += (targetRot - birdRotRef.current) * 0.18;

          if (s.dead) {
            deadSinceRef.current = now;
            for (let i = 0; i < 18; i++) {
              particlesRef.current.push({
                x: s.bird.x, y: s.bird.y,
                vx: rand(-4, 4), vy: rand(-5, -1),
                life: 50, max: 50, r: rand(2, 4),
                color: "rgba(255,120,160,1)", kind: "splash", g: 0.18,
              });
            }
            statsRef.current = {
              pipesPassed: plan.pipesPassed,
              droplets: plan.dropletsCollected,
              run: statsRef.current.run,
            };
            // Fire the run-ended callback exactly once per run.
            if (!runEndFiredRef.current) {
              runEndFiredRef.current = true;
              onRunEndRef.current?.(chestsCollectedRef.current);
            }
          }
        } else {
          step(s, plan.inputs);
          const targetRot = Math.max(-0.7, Math.min(1.2, s.bird.vy * 0.08));
          birdRotRef.current += (targetRot - birdRotRef.current) * 0.18;
          // holdOnDeath freezes the scene on the death frame until the
          // parent resets the seed (which kicks off a fresh run).
          if (!holdOnDeathRef.current
              && deadSinceRef.current
              && now - deadSinceRef.current > POST_DEATH_MS) {
            startNewRun();
            statsRef.current = { pipesPassed: 0, droplets: 0, run: statsRef.current.run + 1 };
          }
        }

        groundXRef.current = (groundXRef.current - 1.6 + 32) % 32;
        for (const b of bubblesRef.current) {
          b.y -= b.vy;
          b.tw += 0.07;
          if (b.y < -10) { b.y = H - GROUND_H + rand(0, 40); b.x = rand(0, W); }
        }
        for (const wd of weedsRef.current) {
          wd.x -= wd.layer === 0 ? 0.4 : 0.9;
          if (wd.x + wd.w < -20) wd.x = W + rand(0, 60);
        }

        for (const p of particlesRef.current) {
          p.x += p.vx;
          p.y += p.vy;
          if (p.g) p.vy += p.g;
          p.life -= 1;
        }
        particlesRef.current = particlesRef.current.filter(p => p.life > 0);

        for (const t of trailRef.current) t.life -= 1;
        trailRef.current = trailRef.current.filter(t => t.life > 0);

        frameClockRef.current += 1;
        } // end stepsPerTick loop
      } // end accumulator loop

      render(ctx);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixedSeed]);

  function render(ctx: CanvasRenderingContext2D) {
    const s = stateRef.current;
    const frame = frameClockRef.current;
    if (!s) return;

    ctx.clearRect(0, 0, W, H);

    const sky = ctx.createLinearGradient(0, 0, 0, H - GROUND_H);
    sky.addColorStop(0, "#7ad3e0");
    sky.addColorStop(0.25, "#2a9ac2");
    sky.addColorStop(0.6, "#0e4a7c");
    sky.addColorStop(1, "#041a3a");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H - GROUND_H);

    const shimmer = ctx.createLinearGradient(0, 0, 0, 40);
    shimmer.addColorStop(0, "rgba(255,255,255,0.35)");
    shimmer.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = shimmer;
    ctx.fillRect(0, 0, W, 40);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 5; i++) {
      const baseX = ((i * 140 + frame * 0.4) % (W + 240)) - 120;
      ctx.fillStyle = "rgba(200, 230, 255, 0.05)";
      ctx.beginPath();
      ctx.moveTo(baseX, 0);
      ctx.lineTo(baseX + 50, 0);
      ctx.lineTo(baseX + 210, H - GROUND_H);
      ctx.lineTo(baseX + 170, H - GROUND_H);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    for (const sb of bubblesRef.current) {
      const a = 0.35 + Math.sin(sb.tw) * 0.15;
      ctx.strokeStyle = `rgba(220, 240, 255, ${a + 0.35})`;
      ctx.lineWidth = 1;
      ctx.fillStyle = `rgba(180, 220, 255, ${a * 0.35})`;
      ctx.beginPath();
      ctx.arc(sb.x, sb.y, sb.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = `rgba(255,255,255,${a + 0.4})`;
      ctx.beginPath();
      ctx.arc(sb.x - sb.r * 0.4, sb.y - sb.r * 0.4, Math.max(0.6, sb.r * 0.25), 0, Math.PI * 2);
      ctx.fill();
    }

    const baseY = H - GROUND_H;
    for (const h of weedsRef.current) {
      const isFar = h.layer === 0;
      ctx.strokeStyle = isFar ? "rgba(25, 90, 80, 0.55)" : "rgba(10, 60, 45, 0.95)";
      ctx.lineWidth = isFar ? 3 : 5;
      ctx.lineCap = "round";
      const blades = isFar ? 3 : 4;
      for (let i = 0; i < blades; i++) {
        const bx = h.x + (i + 0.5) * (h.w / blades);
        const bladeH = h.h * 0.85;
        ctx.beginPath();
        ctx.moveTo(bx, baseY);
        const segs = 5;
        for (let st = 1; st <= segs; st++) {
          const t = st / segs;
          const wy = baseY - t * bladeH;
          const wx = bx + Math.sin(frame * 0.04 + i * 0.9 + h.x * 0.02 + t * 2) * 7 * t;
          ctx.lineTo(wx, wy);
        }
        ctx.stroke();
      }
    }

    for (const t of trailRef.current) {
      const a = Math.max(0, t.life / 30);
      ctx.fillStyle = `rgba(30, 10, 60, ${a * 0.5})`;
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r * a, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const p of s.pipes) {
      drawPipe(ctx, p.x, p.top, true, frame);
      drawPipe(ctx, p.x, p.top, false, frame);
    }

    for (const d of s.droplets) {
      if (d.collected) continue;
      const c = collectibleForPos(d.x, d.y);
      if (c.kind === "chest") drawChest(ctx, d.x, d.y, frame, c.tier);
      else                    drawDroplet(ctx, d.x, d.y, d.r, frame);
    }

    for (const p of particlesRef.current) {
      const a = p.life / p.max;
      if (p.kind === "puff") {
        ctx.strokeStyle = `rgba(220,240,255,${a * 0.9})`;
        ctx.fillStyle = `rgba(180,220,255,${a * 0.25})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillStyle = p.color.replace(/[\d.]+\)$/g, `${a})`);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const ground = ctx.createLinearGradient(0, H - GROUND_H, 0, H);
    ground.addColorStop(0, "#d5b47c");
    ground.addColorStop(1, "#6f4c22");
    ctx.fillStyle = ground;
    ctx.fillRect(0, H - GROUND_H, W, GROUND_H);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 6; i++) {
      const cx = ((i * 90 + frame * 0.6) % (W + 120)) - 60;
      const cy = H - GROUND_H + 10 + Math.sin(frame * 0.03 + i) * 3;
      const rx = 40 + Math.sin(frame * 0.05 + i * 1.7) * 12;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rx);
      grad.addColorStop(0, "rgba(255, 240, 200, 0.25)");
      grad.addColorStop(1, "rgba(255, 240, 200, 0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, 6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    ctx.fillStyle = "rgba(40, 25, 8, 0.4)";
    ctx.fillRect(0, H - GROUND_H, W, 2);

    const groundX = groundXRef.current;
    for (let x = groundX; x < W + 32; x += 32) {
      ctx.fillStyle = "rgba(60, 38, 14, 0.55)";
      ctx.beginPath();
      ctx.arc(x + 8, H - GROUND_H + 14, 3, 0, Math.PI * 2);
      ctx.arc(x + 18, H - GROUND_H + 10, 2, 0, Math.PI * 2);
      ctx.arc(x + 24, H - GROUND_H + 18, 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 230, 200, 0.6)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x + 14, H - GROUND_H + 22, 2.4, Math.PI, 0);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(60, 30, 10, 0.18)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      const yy = H - GROUND_H + 30 + i * 10;
      ctx.beginPath();
      ctx.moveTo(0, yy);
      for (let x = 0; x <= W; x += 16) ctx.lineTo(x, yy + Math.sin((x + groundX) * 0.08) * 1.2);
      ctx.stroke();
    }

    drawBird(ctx, s.bird, birdRotRef.current, flapPhaseRef.current, frame);

    if (!s.dead) {
      ctx.save();
      ctx.textAlign = "center";
      ctx.font = '900 56px "Rubik", sans-serif';
      ctx.lineWidth = 8;
      ctx.strokeStyle = "rgba(2, 10, 25, 0.7)";
      ctx.strokeText(String(s.score), W / 2, 88);
      ctx.shadowColor = "rgba(95, 216, 255, 0.5)";
      ctx.shadowBlur = 20;
      ctx.fillStyle = "#fff";
      ctx.fillText(String(s.score), W / 2, 88);
      ctx.restore();
    }

    const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.75);
    vig.addColorStop(0, "rgba(0,0,0,0)");
    vig.addColorStop(1, "rgba(0,0,0,0.45)");
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);

    // DEMO badge — only visible until the player kicks off a real
    // on-chain round. Subtle pulse via frame sine so it reads as UI,
    // not debug text.
    if (demoRef.current) {
      const pulse = 0.65 + Math.sin(frame * 0.08) * 0.15;
      ctx.save();
      ctx.fillStyle = `rgba(127, 227, 255, ${pulse * 0.18})`;
      ctx.fillRect(W / 2 - 66, 24, 132, 34);
      ctx.strokeStyle = `rgba(127, 227, 255, ${pulse * 0.9})`;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(W / 2 - 66, 24, 132, 34);
      ctx.fillStyle = `rgba(207, 231, 255, ${pulse})`;
      ctx.font = 'bold 14px "Rubik", sans-serif';
      ctx.textAlign = "center";
      ctx.fillText("DEMO MODE", W / 2, 46);
      ctx.textAlign = "start";
      ctx.restore();
    }

    if (s.dead) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
      ctx.fillRect(0, H / 2 - 38, W, 76);
      ctx.textAlign = "center";
      ctx.fillStyle = "#ff8b8b";
      ctx.font = 'bold 28px "Rubik", sans-serif';
      ctx.fillText("the squid died", W / 2, H / 2 - 4);
      ctx.fillStyle = "#cfe7ff";
      ctx.font = '14px "Rubik", sans-serif';
      const sr = statsRef.current;
      ctx.fillText(`run #${sr.run} · pipes ${sr.pipesPassed} · drops ${sr.droplets}`, W / 2, H / 2 + 20);
      ctx.textAlign = "start";
    }

    ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
    ctx.fillRect(8, H - GROUND_H - 36, 174, 28);
    ctx.fillStyle = "#cfe7ff";
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillText(
      `auto · run ${statsRef.current.run} · seed ${seedRef.current.toString(16).padStart(8, "0")}`,
      14,
      H - GROUND_H - 18,
    );
  }

  return (
    <div style={{ width: "100%", margin: "0 auto" }}>
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        style={{
          width: "100%",
          height: "auto",
          aspectRatio: `${W} / ${H}`,
          background: "#021830",
          border: "1px solid rgba(120, 200, 255, 0.18)",
          borderRadius: 14,
          display: "block",
        }}
      />
      <div style={{
        marginTop: 12,
        textAlign: "center",
        fontFamily: "ui-monospace, monospace",
        fontSize: 12,
        color: "#7b94b8",
      }}>
        provably fair · auto-restarts on death
      </div>
    </div>
  );
}

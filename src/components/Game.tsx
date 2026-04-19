"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  initialState,
  step,
  type SimState,
  type SimInput,
  type Bird as SimBird,
  W,
  H,
  PIPE_GAP,
  PIPE_WIDTH,
  GROUND_H,
  PIPE_SPEED,
} from "@/lib/simulate";

type GameProps = {
  canStart: boolean;
  onBeforeStart: () => Promise<{ attemptId: string; seed: number } | null>;
  onGameOver: (result: {
    attemptId: string;
    seed: number;
    inputs: SimInput[];
    claimedScore: number;
  }) => void;
};

type Particle = {
  x: number; y: number; vx: number; vy: number;
  life: number; max: number; r: number;
  color: string; kind: "puff" | "splash"; g?: number;
};
type TrailDot = { x: number; y: number; r: number; life: number };
type Bubble = { x: number; y: number; r: number; tw: number; vy: number };
type Weed = { layer: 0 | 1; x: number; w: number; h: number };

const UI_STATE = { MENU: 0, PLAYING: 1, DEAD: 2 } as const;
type UiState = (typeof UI_STATE)[keyof typeof UI_STATE];

const STEP_MS = 1000 / 60;
const MAX_FRAME_MS = 250;

function rand(a: number, b: number) { return a + Math.random() * (b - a); }

function medalFor(s: number) {
  if (s >= 50) return "platinum";
  if (s >= 25) return "gold";
  if (s >= 10) return "silver";
  if (s >= 3) return "bronze";
  return null;
}

export function Game({ canStart, onBeforeStart, onGameOver }: GameProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [ui, setUi] = useState<UiState>(UI_STATE.MENU);
  const [paused, setPaused] = useState(false);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [medal, setMedal] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [practice, setPractice] = useState(false);

  const simRef = useRef<SimState | null>(null);
  const inputsRef = useRef<SimInput[]>([]);
  const attemptIdRef = useRef<string | null>(null);
  const seedRef = useRef<number | null>(null);
  const practiceRef = useRef(false);
  useEffect(() => { practiceRef.current = practice; }, [practice]);

  const particlesRef = useRef<Particle[]>([]);
  const trailRef = useRef<TrailDot[]>([]);
  const bubblesRef = useRef<Bubble[]>([]);
  const weedsRef = useRef<Weed[]>([]);
  const birdFlapPhase = useRef(0);
  const birdRot = useRef(0);
  const groundXRef = useRef(0);
  const shakeRef = useRef(0);
  const frameClockRef = useRef(0);

  const uiRef = useRef<UiState>(UI_STATE.MENU);
  const pausedRef = useRef(false);
  const startingRef = useRef(false);
  useEffect(() => { uiRef.current = ui; }, [ui]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { startingRef.current = starting; }, [starting]);

  const initParallax = useCallback(() => {
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
  }, []);

  const startGame = useCallback(async () => {
    if (!canStart || startingRef.current) return;
    setStarting(true);
    try {
      const handshake = await onBeforeStart();
      if (!handshake) return;
      attemptIdRef.current = handshake.attemptId;
      seedRef.current = handshake.seed;
      inputsRef.current = [];
      simRef.current = initialState(handshake.seed);
      particlesRef.current = [];
      trailRef.current = [];
      shakeRef.current = 0;
      setScore(0);
      setMedal(null);
      setPractice(false);
      practiceRef.current = false;
      uiRef.current = UI_STATE.PLAYING;
      setUi(UI_STATE.PLAYING);
    } finally {
      setStarting(false);
    }
  }, [canStart, onBeforeStart]);

  // Practice mode: no server handshake, no DB write, no leaderboard.
  // Free to play for anyone (even without wallet / attempts). Score is
  // displayed locally and discarded.
  const startPractice = useCallback(() => {
    if (startingRef.current) return;
    const seed = Math.floor(Math.random() * 0xffffffff);
    attemptIdRef.current = null;  // null → onGameOver skipped by the loop
    seedRef.current = seed;
    inputsRef.current = [];
    simRef.current = initialState(seed);
    particlesRef.current = [];
    trailRef.current = [];
    shakeRef.current = 0;
    setScore(0);
    setMedal(null);
    setPractice(true);
    practiceRef.current = true;
    uiRef.current = UI_STATE.PLAYING;
    setUi(UI_STATE.PLAYING);
  }, []);

  const flap = useCallback(() => {
    if (pausedRef.current) return;
    if (uiRef.current !== UI_STATE.PLAYING) return;
    const sim = simRef.current;
    if (!sim || sim.dead) return;
    inputsRef.current.push({ f: sim.frame, t: "flap" });
    birdFlapPhase.current = 0;
    for (let i = 0; i < 6; i++) {
      particlesRef.current.push({
        x: sim.bird.x - 10, y: sim.bird.y + rand(-3, 5),
        vx: rand(-1.8, -0.4), vy: rand(-1.2, -0.1),
        life: 26, max: 26, r: rand(1.5, 3.5),
        color: "rgba(200,230,255,0.85)", kind: "puff",
      });
    }
  }, []);

  const togglePause = useCallback(() => {
    if (uiRef.current !== UI_STATE.PLAYING && !pausedRef.current) return;
    setPaused((p) => !p);
  }, []);

  const retry = useCallback(() => {
    setPaused(false);
    uiRef.current = UI_STATE.MENU;
    setUi(UI_STATE.MENU);
    simRef.current = null;
    attemptIdRef.current = null;
    seedRef.current = null;
    inputsRef.current = [];
    particlesRef.current = [];
    trailRef.current = [];
    setPractice(false);
    practiceRef.current = false;
  }, []);

  const updateVisuals = useCallback(() => {
    const frame = frameClockRef.current;
    groundXRef.current = (groundXRef.current - PIPE_SPEED) % 32;
    shakeRef.current *= 0.85;

    for (const s of bubblesRef.current) {
      s.y -= s.vy;
      s.x += Math.sin(s.tw) * 0.3 - 0.15;
      s.tw += 0.05;
      if (s.y < -6 || s.x < -6) {
        s.y = H - GROUND_H - rand(0, 40);
        s.x = Math.random() * W;
      }
    }
    for (const h of weedsRef.current) {
      h.x -= h.layer === 0 ? 0.3 : 0.7;
      if (h.x + h.w < 0) h.x = W + Math.random() * 40;
    }

    const particles = particlesRef.current;
    for (const p of particles) {
      p.x += p.vx; p.y += p.vy;
      if (p.g) p.vy += p.g;
      p.life--;
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      if (particles[i].life <= 0) particles.splice(i, 1);
    }

    if (uiRef.current === UI_STATE.MENU) birdFlapPhase.current += 0.25;

    if (uiRef.current === UI_STATE.PLAYING) {
      const sim = simRef.current;
      if (sim && frame % 3 === 0) {
        trailRef.current.push({ x: sim.bird.x - 10, y: sim.bird.y + 4, r: rand(3, 5), life: 30 });
      }
      for (const t of trailRef.current) t.life--;
      while (trailRef.current.length && trailRef.current[0].life <= 0) trailRef.current.shift();
    }
  }, []);

  const render = useCallback((ctx: CanvasRenderingContext2D) => {
    const frame = frameClockRef.current;
    const shake = shakeRef.current;
    const sim = simRef.current;
    ctx.save();
    if (shake > 0.3) ctx.translate(rand(-shake, shake), rand(-shake, shake));
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

    for (const s of bubblesRef.current) {
      const a = 0.35 + Math.sin(s.tw) * 0.15;
      ctx.strokeStyle = `rgba(220, 240, 255, ${a + 0.35})`;
      ctx.lineWidth = 1;
      ctx.fillStyle = `rgba(180, 220, 255, ${a * 0.35})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = `rgba(255,255,255,${a + 0.4})`;
      ctx.beginPath();
      ctx.arc(s.x - s.r * 0.4, s.y - s.r * 0.4, Math.max(0.6, s.r * 0.25), 0, Math.PI * 2);
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
        for (let s = 1; s <= segs; s++) {
          const t = s / segs;
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

    if (sim) {
      for (const p of sim.pipes) {
        drawPipe(ctx, p.x, p.top, true, frame);
        drawPipe(ctx, p.x, p.top, false, frame);
      }
      for (const d of sim.droplets) {
        if (d.collected) continue;
        const y = d.y + Math.sin(frame * 0.15) * 3;
        const halo = ctx.createRadialGradient(d.x, y, 2, d.x, y, d.r * 2.4);
        halo.addColorStop(0, "rgba(180, 140, 255, 0.55)");
        halo.addColorStop(1, "rgba(180, 140, 255, 0)");
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(d.x, y, d.r * 2.4, 0, Math.PI * 2);
        ctx.fill();

        ctx.save();
        ctx.translate(d.x, y);
        const body = ctx.createRadialGradient(-3, -4, 1, 0, 0, d.r);
        body.addColorStop(0, "#6a3fd0");
        body.addColorStop(0.6, "#2a1060");
        body.addColorStop(1, "#0a0224");
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.moveTo(0, -d.r * 1.25);
        ctx.bezierCurveTo(d.r * 1.05, -d.r * 0.2, d.r, d.r, 0, d.r);
        ctx.bezierCurveTo(-d.r, d.r, -d.r * 1.05, -d.r * 0.2, 0, -d.r * 1.25);
        ctx.fill();
        ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
        ctx.beginPath();
        ctx.ellipse(-d.r * 0.3, -d.r * 0.3, d.r * 0.22, d.r * 0.38, -0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
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

    const bird: SimBird = sim
      ? sim.bird
      : { x: W * 0.28, y: H * 0.45 + Math.sin(frame / 15) * 6, vy: 0, r: 16 };
    drawBird(ctx, bird, birdRot.current, birdFlapPhase.current, frame);

    if (uiRef.current === UI_STATE.PLAYING && sim) {
      ctx.save();
      ctx.textAlign = "center";
      ctx.font = '900 56px "Rubik", sans-serif';
      ctx.lineWidth = 8;
      ctx.strokeStyle = "rgba(2, 10, 25, 0.7)";
      ctx.strokeText(String(sim.score), W / 2, 88);
      ctx.shadowColor = "rgba(95, 216, 255, 0.5)";
      ctx.shadowBlur = 20;
      ctx.fillStyle = "#fff";
      ctx.fillText(String(sim.score), W / 2, 88);
      ctx.restore();
    }

    const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.75);
    vig.addColorStop(0, "rgba(0,0,0,0)");
    vig.addColorStop(1, "rgba(0,0,0,0.45)");
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);

    ctx.restore();
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("inkbird.best");
      const parsed = parseInt(raw ?? "0", 10);
      if (Number.isFinite(parsed)) setBest(parsed);
    } catch {}

    initParallax();

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let rafId = 0;
    let lastTime = 0;
    let accumulator = 0;

    const loop = (now: number) => {
      if (!lastTime) lastTime = now;
      const elapsed = Math.min(MAX_FRAME_MS, now - lastTime);
      lastTime = now;

      if (!pausedRef.current) {
        accumulator += elapsed;
        while (accumulator >= STEP_MS) {
          updateVisuals();
          if (uiRef.current === UI_STATE.PLAYING && simRef.current) {
            const sim = simRef.current;
            const prevDead = sim.dead;
            const prevScore = sim.score;
            step(sim, inputsRef.current);
            birdRot.current = Math.max(-0.5, Math.min(1.2, sim.bird.vy / 10));
            birdFlapPhase.current += sim.bird.vy < 0 ? 0.6 : 0.3;
            if (sim.score !== prevScore) setScore(sim.score);
            if (!prevDead && sim.dead) {
              shakeRef.current = 14;
              for (const color of ["rgba(30, 10, 60, 0.9)", "rgba(120, 60, 200, 0.8)"]) {
                for (let i = 0; i < 14; i++) {
                  const a = Math.random() * Math.PI * 2;
                  const sp = rand(1.5, 4);
                  particlesRef.current.push({
                    x: sim.bird.x, y: sim.bird.y,
                    vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1,
                    life: 28 + Math.random() * 10, max: 36,
                    r: rand(1.5, 3.5), color, kind: "splash", g: 0.2,
                  });
                }
              }
              const finalScore = sim.score;
              setBest((b) => {
                if (finalScore > b) {
                  try { localStorage.setItem("inkbird.best", String(finalScore)); } catch {}
                  return finalScore;
                }
                return b;
              });
              setMedal(medalFor(finalScore));
              const aId = attemptIdRef.current;
              const seed = seedRef.current;
              const capturedInputs = [...inputsRef.current];
              window.setTimeout(() => {
                if (uiRef.current === UI_STATE.PLAYING) {
                  uiRef.current = UI_STATE.DEAD;
                  setUi(UI_STATE.DEAD);
                  if (aId !== null && seed !== null) {
                    onGameOver({ attemptId: aId, seed, inputs: capturedInputs, claimedScore: finalScore });
                  }
                }
              }, 500);
            }
          }
          frameClockRef.current++;
          accumulator -= STEP_MS;
        }
      } else {
        accumulator = 0;
      }
      render(ctx);
      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [initParallax, render, updateVisuals, onGameOver]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "ArrowUp") {
        e.preventDefault();
        if (uiRef.current === UI_STATE.DEAD) retry();
        else if (uiRef.current === UI_STATE.MENU) startGame();
        else flap();
      } else if (e.key === "p" || e.key === "P") {
        e.preventDefault();
        togglePause();
      } else if (e.key === "r" || e.key === "R") {
        retry();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flap, retry, startGame, togglePause]);

  const onCanvasTap = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (uiRef.current === UI_STATE.MENU) {
      // Paid is the default on tap if the player has attempts, otherwise
      // fall through to practice so the game is playable without a wallet.
      if (canStart) startGame();
      else startPractice();
    } else if (uiRef.current === UI_STATE.PLAYING) {
      flap();
    }
  }, [canStart, flap, startGame, startPractice]);

  return (
    <div className="canvas-wrap">
      <canvas
        ref={canvasRef}
        id="game"
        width={W}
        height={H}
        onMouseDown={onCanvasTap}
        onTouchStart={onCanvasTap}
      />

      {ui === UI_STATE.MENU && (
        <div className="screen" onClick={canStart ? startGame : startPractice}>
          <div className="screen-inner">
            <h2>INK SQUID</h2>
            <p className="subtitle">Swim through the reef. Collect ink droplets.</p>
            <button
              className="big-btn"
              onClick={(e) => { e.stopPropagation(); startGame(); }}
              type="button"
              disabled={!canStart || starting}
            >
              {starting ? "LOADING…" : "PLAY FOR PRIZES"}
            </button>
            <button
              className="ghost-btn"
              onClick={(e) => { e.stopPropagation(); startPractice(); }}
              type="button"
            >
              Practice — free, no prize
            </button>
            <p className="hint">
              {canStart
                ? "Space / Tap / Click to swim"
                : "Buy a pack to enter the weekly pool"}
            </p>
          </div>
        </div>
      )}

      {ui === UI_STATE.DEAD && (
        <div className="screen" onClick={retry}>
          <div className="screen-inner card">
            <h2 className="danger">CAUGHT!</h2>
            {practice && <div className="practice-badge">PRACTICE — not counted</div>}
            <div className="stats">
              <div className="stat"><span>Ink</span><b>{score}</b></div>
              <div className="stat"><span>Best</span><b>{best}</b></div>
            </div>
            {!practice && medal && <div className={`medal ${medal}`}>{medal.toUpperCase()}</div>}
            <button className="big-btn" onClick={(e) => { e.stopPropagation(); retry(); }} type="button">
              {canStart ? "PLAY AGAIN" : practice ? "PRACTICE AGAIN" : "OUT OF TRIES"}
            </button>
          </div>
        </div>
      )}

      {paused && (
        <div className="screen" onClick={togglePause}>
          <div className="screen-inner">
            <h2>PAUSED</h2>
            <button className="big-btn" onClick={(e) => { e.stopPropagation(); togglePause(); }} type="button">
              RESUME
            </button>
          </div>
        </div>
      )}

      <div className="hud">
        <div className="chip"><span>Score</span><b>{score}</b></div>
        <div className="chip"><span>Best</span><b>{best}</b></div>
        {practice && <div className="chip practice-chip"><span>Practice</span></div>}
        <button className="icon-btn" onClick={togglePause} type="button" title="Pause (P)">PAUSE</button>
      </div>
    </div>
  );
}

function drawPipe(ctx: CanvasRenderingContext2D, x: number, topH: number, isTop: boolean, frame: number) {
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

function drawBird(
  ctx: CanvasRenderingContext2D,
  bird: SimBird,
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

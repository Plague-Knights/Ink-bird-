"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { keccak256, formatEther, parseEther, toHex } from "viem";
import { ConnectWallet } from "@/components/ConnectWallet";
import { useAuth } from "@/lib/useSession";

type Tier = "low" | "mid" | "high";

type PlayResult = {
  roundId: string;
  seedHash: `0x${string}`;
  seed: `0x${string}`;
  userSalt: `0x${string}`;
  tier: Tier;
  outcomeIndex: number;
  distance: number;
  betWei: string;
  payoutWei: string;
  balanceWei: string;
};

const TIER_META: Record<Tier, { label: string; blurb: string }> = {
  low: { label: "Shallow", blurb: "Tight variance, small wins" },
  mid: { label: "Reef", blurb: "Moderate swings, balanced" },
  high: { label: "Abyss", blurb: "Mostly losses, huge payouts" },
};

function randSalt(): `0x${string}` {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return toHex(buf);
}

export default function DivePage() {
  const { signedIn, loaded } = useAuth();
  const [balance, setBalance] = useState<bigint | null>(null);
  const [tier, setTier] = useState<Tier>("mid");
  const [betStr, setBetStr] = useState<string>("0.01");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Two-phase reveal: pending holds the verified result while the squid
  // is still animating so the outcome card stays hidden. On anim complete
  // we hoist it to `result` and the payout panel fades in.
  const [pending, setPending] = useState<PlayResult | null>(null);
  const [result, setResult] = useState<PlayResult | null>(null);
  const [animating, setAnimating] = useState(false);

  const refreshBalance = useCallback(async () => {
    if (!signedIn) return;
    try {
      const res = await fetch("/api/dive/balance", { cache: "no-store" });
      const j = await res.json();
      if (typeof j.balanceWei === "string") setBalance(BigInt(j.balanceWei));
    } catch {}
  }, [signedIn]);

  useEffect(() => {
    if (loaded && signedIn) refreshBalance();
  }, [loaded, signedIn, refreshBalance]);

  const faucet = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/dive/faucet", { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Faucet failed");
      setBalance(BigInt(j.balanceWei));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Faucet failed");
    }
  }, []);

  const dive = useCallback(async () => {
    setError(null);
    setResult(null);
    setPending(null);
    let betWei: bigint;
    try {
      betWei = parseEther(betStr || "0");
    } catch {
      setError("Invalid bet amount");
      return;
    }
    if (betWei <= 0n) {
      setError("Bet must be > 0");
      return;
    }
    setBusy(true);
    try {
      const openRes = await fetch("/api/dive/open", { method: "POST" });
      const openJson = await openRes.json();
      if (!openRes.ok) throw new Error(openJson.error ?? "Open failed");
      const roundId = openJson.roundId as string;
      const committedHash = openJson.seedHash as `0x${string}`;

      const userSalt = randSalt();
      const playRes = await fetch("/api/dive/play", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roundId, userSalt, tier, betWei: betWei.toString() }),
      });
      const playJson = await playRes.json();
      if (!playRes.ok) throw new Error(playJson.error ?? "Play failed");

      // Verify client-side that the revealed seed matches the earlier
      // commit. Any mismatch means the server swapped seeds and we
      // should not trust the outcome.
      const reveal: PlayResult = playJson;
      const recomputed = keccak256(reveal.seed);
      if (recomputed.toLowerCase() !== committedHash.toLowerCase()) {
        throw new Error("Seed reveal does not match commit — refusing outcome");
      }

      // Hold the outcome off-screen until the dive completes. The canvas
      // gets `distance` via `pending` so it has a target to animate to.
      setAnimating(true);
      setPending(reveal);
      setBalance(BigInt(reveal.balanceWei));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Dive failed");
    } finally {
      setBusy(false);
    }
  }, [betStr, tier]);

  if (!loaded) {
    return <div className="wrap"><p>Loading…</p></div>;
  }

  return (
    <div className="wrap">
      <div className="topbar">
        <h1>Squid Dive</h1>
        <ConnectWallet />
      </div>

      {!signedIn ? (
        <div className="panel">
          <p>Sign in to play the dive prototype.</p>
        </div>
      ) : (
        <>
          <DiveCanvas
            distance={pending?.distance ?? result?.distance ?? null}
            animating={animating}
            onAnimDone={() => {
              setAnimating(false);
              if (pending) {
                setResult(pending);
                setPending(null);
              }
            }}
          />

          <div className="panel">
            <div className="panel-row">
              <div className="stat">
                <span>Balance</span>
                <b>{balance == null ? "…" : `${Number(formatEther(balance)).toFixed(4)} tETH`}</b>
              </div>
              <button className="icon-btn" onClick={faucet} type="button">
                + 0.1 tETH FAUCET
              </button>
            </div>
          </div>

          <div className="panel">
            <h3 className="panel-title">Depth tier</h3>
            <div className="tier-row">
              {(["low", "mid", "high"] as Tier[]).map((t) => (
                <button
                  key={t}
                  className={`tier-btn${tier === t ? " tier-btn-on" : ""}`}
                  onClick={() => setTier(t)}
                  type="button"
                >
                  <b>{TIER_META[t].label}</b>
                  <span>{TIER_META[t].blurb}</span>
                </button>
              ))}
            </div>

            <div className="panel-row buy-row">
              <input
                className="week-input"
                inputMode="decimal"
                value={betStr}
                onChange={(e) => setBetStr(e.target.value)}
                placeholder="Bet in ETH"
              />
              <button
                className="big-btn"
                onClick={dive}
                disabled={busy || animating}
                type="button"
              >
                {busy ? "DIVING…" : "DIVE"}
              </button>
            </div>
            {error && <p className="wallet-error">{error}</p>}
          </div>

          {result && (
            <div className="panel">
              <h3 className="panel-title">Outcome</h3>
              <div className="panel-row">
                <div className="stat">
                  <span>Distance</span>
                  <b>{result.distance} m</b>
                </div>
                <div className="stat">
                  <span>Payout</span>
                  <b>{Number(formatEther(BigInt(result.payoutWei))).toFixed(4)} tETH</b>
                </div>
                <div className="stat">
                  <span>Bet</span>
                  <b>{Number(formatEther(BigInt(result.betWei))).toFixed(4)} tETH</b>
                </div>
              </div>
              <details>
                <summary>Fairness proof</summary>
                <dl className="proof">
                  <dt>Round</dt><dd><code>{result.roundId}</code></dd>
                  <dt>Seed hash (committed)</dt><dd><code>{result.seedHash}</code></dd>
                  <dt>Seed (revealed)</dt><dd><code>{result.seed}</code></dd>
                  <dt>Your salt</dt><dd><code>{result.userSalt}</code></dd>
                  <dt>Outcome index</dt><dd>{result.outcomeIndex} / 256</dd>
                  <dt>Verify</dt>
                  <dd>
                    <a href={`/api/dive/verify/${result.roundId}`} target="_blank" rel="noreferrer">
                      /api/dive/verify/{result.roundId.slice(0, 10)}…
                    </a>
                  </dd>
                </dl>
              </details>
            </div>
          )}
        </>
      )}
    </div>
  );
}

type Bubble = { x: number; y: number; r: number; vy: number; life: number };
type Particle = { x: number; y: number; r: number; vx: number; vy: number; life: number; max: number; hue: string };
type Plankton = { x: number; y: number; r: number; tw: number; twSpeed: number; vy: number };

function drawSquid(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  phase: number,
  speed: number,
) {
  const stretch = 1 + Math.min(0.45, speed * 0.025);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, stretch);

  // Soft outer glow so the squid reads against the dark water
  const glow = ctx.createRadialGradient(0, -6, 4, 0, -6, 52);
  glow.addColorStop(0, "rgba(159, 124, 255, 0.35)");
  glow.addColorStop(1, "rgba(159, 124, 255, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, -6, 52, 0, Math.PI * 2);
  ctx.fill();

  // Tentacles first so mantle draws over their roots
  for (let i = 0; i < 10; i++) {
    const t = i / 9 - 0.5;
    const rootX = t * 20;
    const wave = Math.sin(phase * 2 + i * 0.7);
    const length = 30 + (1 - Math.abs(t) * 1.3) * 12;
    const tipX = t * 30 + wave * 3;
    const midX = (rootX + tipX) / 2 + Math.sin(phase * 1.6 + i) * 5;
    // Tapered: fat at root, thin at tip, drawn as filled quad
    ctx.fillStyle = "#7a5fd6";
    ctx.beginPath();
    ctx.moveTo(rootX - 2.2, 12);
    ctx.quadraticCurveTo(midX + 1, 22, tipX + 0.5, 14 + length + wave * 1.5);
    ctx.quadraticCurveTo(midX - 1, 22, rootX + 2.2, 12);
    ctx.closePath();
    ctx.fill();
  }
  // Two longer feeding arms, outermost
  for (const sign of [-1, 1] as const) {
    const wave = Math.sin(phase * 1.8 + sign);
    ctx.fillStyle = "#b196ff";
    ctx.beginPath();
    ctx.moveTo(sign * 10 - 1.5, 12);
    ctx.quadraticCurveTo(sign * 18 + wave * 3, 30, sign * 23 + wave * 4, 60);
    ctx.quadraticCurveTo(sign * 18 + wave * 3, 30, sign * 10 + 1.5, 12);
    ctx.closePath();
    ctx.fill();
  }

  // Fins — side triangles near the top of the mantle
  ctx.fillStyle = "rgba(120, 180, 255, 0.6)";
  ctx.beginPath();
  ctx.moveTo(-12, -20);
  ctx.lineTo(-24, -28 + Math.sin(phase * 1.4) * 2);
  ctx.lineTo(-12, -4);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(12, -20);
  ctx.lineTo(24, -28 + Math.sin(phase * 1.4 + Math.PI) * 2);
  ctx.lineTo(12, -4);
  ctx.closePath();
  ctx.fill();

  // Mantle — teardrop pointing up, head/tentacles down. Iridescent gradient.
  const mantleGrad = ctx.createLinearGradient(-12, -40, 12, 20);
  mantleGrad.addColorStop(0, "#e7d8ff");
  mantleGrad.addColorStop(0.3, "#9f7cff");
  mantleGrad.addColorStop(0.7, "#6b82ff");
  mantleGrad.addColorStop(1, "#5fd8ff");
  ctx.fillStyle = mantleGrad;
  ctx.beginPath();
  ctx.moveTo(0, -42);
  ctx.bezierCurveTo(-15, -36, -18, 0, -12, 16);
  ctx.bezierCurveTo(-9, 20, 9, 20, 12, 16);
  ctx.bezierCurveTo(18, 0, 15, -36, 0, -42);
  ctx.fill();

  // Highlight sheen along the upper-left of the mantle
  ctx.fillStyle = "rgba(255, 255, 255, 0.28)";
  ctx.beginPath();
  ctx.ellipse(-5, -22, 3.5, 12, -0.25, 0, Math.PI * 2);
  ctx.fill();

  // Eye — larger with sparkle
  ctx.fillStyle = "#021629";
  ctx.beginPath();
  ctx.arc(-5, -3, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#5fd8ff";
  ctx.beginPath();
  ctx.arc(-5, -3, 2.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(-4, -4.5, 1.3, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function DiveCanvas({
  distance,
  animating,
  onAnimDone,
}: {
  distance: number | null;
  animating: boolean;
  onAnimDone: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const startRef = useRef<number>(0);
  const bubblesRef = useRef<Bubble[]>([]);
  const inkRef = useRef<Particle[]>([]);
  const planktonRef = useRef<Plankton[] | null>(null);
  const lastBubbleRef = useRef<number>(0);
  const lastInkRef = useRef<number>(0);
  const flashRef = useRef<number>(0); // 0..1 pulse on reveal

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    const W = canvas.width;
    const H = canvas.height;
    const surfaceY = 42;
    const maxDepthPx = H - surfaceY - 36;
    const maxDepthM = 1000;

    // Lazily seed plankton field. They're cosmetic so deterministic isn't
    // important, but we keep them between frames so they drift smoothly.
    if (!planktonRef.current) {
      const arr: Plankton[] = [];
      for (let i = 0; i < 56; i++) {
        arr.push({
          x: Math.random() * W,
          y: surfaceY + Math.random() * (H - surfaceY),
          r: 0.6 + Math.random() * 1.4,
          tw: Math.random() * Math.PI * 2,
          twSpeed: 0.015 + Math.random() * 0.04,
          vy: 0.05 + Math.random() * 0.2,
        });
      }
      planktonRef.current = arr;
    }

    let prevSquidY = surfaceY;
    let lastSettled = false;

    const draw = (now: number) => {
      ctx.clearRect(0, 0, W, H);

      // Sky strip above the surface
      const sky = ctx.createLinearGradient(0, 0, 0, surfaceY);
      sky.addColorStop(0, "#162e52");
      sky.addColorStop(1, "#2d6aa3");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, surfaceY);

      // Ocean gradient — sun-dappled near the surface, crushing black at depth
      const sea = ctx.createLinearGradient(0, surfaceY, 0, H);
      sea.addColorStop(0, "#1a5b9a");
      sea.addColorStop(0.18, "#0e3f78");
      sea.addColorStop(0.45, "#061f4a");
      sea.addColorStop(0.8, "#010720");
      sea.addColorStop(1, "#000309");
      ctx.fillStyle = sea;
      ctx.fillRect(0, surfaceY, W, H - surfaceY);

      // God-ray shafts, opacity fades with depth
      for (let i = 0; i < 5; i++) {
        const rx = ((i + 0.5) * W) / 5 + Math.sin(now / 2400 + i * 1.3) * 22;
        const sway = Math.sin(now / 3200 + i) * 14;
        const grad = ctx.createLinearGradient(0, surfaceY, 0, H * 0.75);
        grad.addColorStop(0, "rgba(160, 220, 240, 0.18)");
        grad.addColorStop(1, "rgba(160, 220, 240, 0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(rx - 22, surfaceY);
        ctx.lineTo(rx + 22, surfaceY);
        ctx.lineTo(rx + 70 + sway, H * 0.8);
        ctx.lineTo(rx - 70 + sway, H * 0.8);
        ctx.closePath();
        ctx.fill();
      }

      // Plankton / marine snow drifting
      const plankton = planktonRef.current!;
      for (const p of plankton) {
        p.tw += p.twSpeed;
        p.y += p.vy;
        p.x += Math.sin(now / 1800 + p.y / 80) * 0.15;
        if (p.y > H + 4) {
          p.y = surfaceY - 2;
          p.x = Math.random() * W;
        }
        const alpha = 0.35 + Math.sin(p.tw) * 0.25;
        ctx.fillStyle = `rgba(180, 230, 255, ${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Surface ripples
      ctx.strokeStyle = "rgba(200, 230, 255, 0.3)";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 4) {
        const y = surfaceY + Math.sin((x + now / 60) / 24) * 2.2;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Depth gridlines + labels
      ctx.fillStyle = "rgba(180, 220, 240, 0.4)";
      ctx.font = "10px Rubik, sans-serif";
      ctx.textAlign = "right";
      for (const m of [100, 250, 500, 750, 1000]) {
        const y = surfaceY + (m / maxDepthM) * maxDepthPx;
        ctx.fillText(`${m}m`, W - 8, y + 3);
        ctx.strokeStyle = "rgba(120, 200, 230, 0.08)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W - 38, y);
        ctx.stroke();
      }
      ctx.textAlign = "start";

      // Squid target + current position
      const cx = W / 2;
      let squidY = surfaceY;
      let speed = 0;
      let dispDepth = 0;
      if (distance != null) {
        const clamped = Math.min(distance, maxDepthM);
        const targetY = surfaceY + (clamped / maxDepthM) * maxDepthPx;
        if (animating) {
          if (!startRef.current) startRef.current = now;
          const tNorm = Math.min(1, (now - startRef.current) / 1800);
          const eased = 1 - Math.pow(1 - tNorm, 3);
          squidY = surfaceY + eased * (targetY - surfaceY);
          dispDepth = Math.round(eased * clamped);
          if (tNorm >= 1) {
            startRef.current = 0;
            if (flashRef.current === 0) flashRef.current = 1;
            onAnimDone();
          }
        } else {
          squidY = targetY;
          dispDepth = clamped;
        }
      }
      speed = squidY - prevSquidY;
      prevSquidY = squidY;

      // Bubble trail — emit while moving
      if (animating && speed > 0.5 && now - lastBubbleRef.current > 35) {
        lastBubbleRef.current = now;
        bubblesRef.current.push({
          x: cx + (Math.random() - 0.5) * 18,
          y: squidY - 4,
          r: 1 + Math.random() * 2.6,
          vy: -0.45 - Math.random() * 0.9,
          life: 90 + Math.random() * 40,
        });
      }
      // Ink puff trail behind the squid for a denser motion feel
      if (animating && speed > 0.5 && now - lastInkRef.current > 90) {
        lastInkRef.current = now;
        for (let i = 0; i < 3; i++) {
          inkRef.current.push({
            x: cx + (Math.random() - 0.5) * 12,
            y: squidY - 6 - Math.random() * 4,
            vx: (Math.random() - 0.5) * 0.3,
            vy: -0.15 - Math.random() * 0.25,
            r: 6 + Math.random() * 8,
            life: 40 + Math.random() * 20,
            max: 60,
            hue: "rgba(140, 80, 210,",
          });
        }
      }
      const ink = inkRef.current;
      for (let i = ink.length - 1; i >= 0; i--) {
        const p = ink[i];
        p.x += p.vx;
        p.y += p.vy;
        p.r *= 1.03;
        p.life -= 1;
        if (p.life <= 0) ink.splice(i, 1);
      }
      for (const p of ink) {
        const a = (p.life / p.max) * 0.28;
        ctx.fillStyle = `${p.hue} ${a.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }

      const bubbles = bubblesRef.current;
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i];
        b.x += Math.sin(now / 400 + b.y / 30) * 0.22;
        b.y += b.vy;
        b.life -= 1;
        if (b.life <= 0 || b.y < surfaceY - 6) bubbles.splice(i, 1);
      }
      ctx.fillStyle = "rgba(200, 230, 255, 0.6)";
      for (const b of bubbles) {
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Squid — phase ticks with real time for continuous undulation
      const phase = now / 140;
      drawSquid(ctx, cx, squidY, phase, Math.max(0, speed));

      // Live depth readout while diving. Sits to the right of the squid,
      // stays attached as it descends. Hidden at rest so it doesn't crowd
      // the settled-state readout.
      if (distance != null && animating) {
        const text = `${dispDepth}m`;
        ctx.font = "bold 14px Rubik, sans-serif";
        const tw = ctx.measureText(text).width;
        ctx.fillStyle = "rgba(2, 22, 41, 0.85)";
        ctx.beginPath();
        ctx.roundRect(cx + 36, squidY - 10, tw + 16, 20, 8);
        ctx.fill();
        ctx.fillStyle = "#a8ecff";
        ctx.fillText(text, cx + 44, squidY + 4);
      }

      // Reveal flash — bright ring from the squid when settling
      if (flashRef.current > 0) {
        const a = flashRef.current;
        const r = 40 + (1 - a) * 120;
        const ring = ctx.createRadialGradient(cx, squidY, r * 0.2, cx, squidY, r);
        ring.addColorStop(0, `rgba(255, 230, 140, ${(a * 0.25).toFixed(3)})`);
        ring.addColorStop(1, "rgba(255, 230, 140, 0)");
        ctx.fillStyle = ring;
        ctx.fillRect(0, 0, W, H);
        flashRef.current = Math.max(0, flashRef.current - 0.03);
      }

      // Settled depth stamp under the squid when at rest
      if (distance != null && !animating) {
        if (!lastSettled) {
          flashRef.current = 1;
          lastSettled = true;
        }
        ctx.font = "bold 22px Rubik, sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(255, 240, 180, 0.95)";
        ctx.fillText(`${distance} m`, cx, Math.min(H - 8, squidY + 72));
        ctx.textAlign = "start";
      } else {
        lastSettled = false;
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [distance, animating, onAnimDone]);

  useEffect(() => {
    if (animating) {
      startRef.current = 0;
      bubblesRef.current = [];
      inkRef.current = [];
      flashRef.current = 0;
    }
  }, [animating]);

  return (
    <div className="dive-canvas-wrap">
      <canvas ref={canvasRef} width={480} height={560} className="dive-canvas" />
    </div>
  );
}

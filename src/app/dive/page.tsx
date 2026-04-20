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

      setAnimating(true);
      setResult(reveal);
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
            distance={result?.distance ?? null}
            animating={animating}
            onAnimDone={() => setAnimating(false)}
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

function drawSquid(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  phase: number,
  speed: number,
) {
  const stretch = 1 + Math.min(0.35, speed * 0.02);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, stretch);

  // Mantle — teardrop pointing up, head/tentacles down. Purple-cyan inky.
  const mantleGrad = ctx.createLinearGradient(0, -36, 0, 20);
  mantleGrad.addColorStop(0, "#9f7cff");
  mantleGrad.addColorStop(1, "#5fd8ff");
  ctx.fillStyle = mantleGrad;
  ctx.beginPath();
  ctx.moveTo(0, -38);
  ctx.bezierCurveTo(-14, -32, -16, 0, -11, 16);
  ctx.bezierCurveTo(-8, 20, 8, 20, 11, 16);
  ctx.bezierCurveTo(16, 0, 14, -32, 0, -38);
  ctx.fill();

  // Fins — side triangles near the top of the mantle
  ctx.fillStyle = "rgba(95, 216, 255, 0.55)";
  ctx.beginPath();
  ctx.moveTo(-11, -20);
  ctx.lineTo(-22, -26 + Math.sin(phase * 1.4) * 1.5);
  ctx.lineTo(-11, -6);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(11, -20);
  ctx.lineTo(22, -26 + Math.sin(phase * 1.4 + Math.PI) * 1.5);
  ctx.lineTo(11, -6);
  ctx.closePath();
  ctx.fill();

  // Eye
  ctx.fillStyle = "#021629";
  ctx.beginPath();
  ctx.arc(-4, -4, 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(-3, -5, 1.2, 0, Math.PI * 2);
  ctx.fill();

  // Tentacles — 8 wavy curves trailing below
  ctx.strokeStyle = "#8a66e8";
  ctx.lineWidth = 2.6;
  ctx.lineCap = "round";
  for (let i = 0; i < 8; i++) {
    const t = i / 7 - 0.5;
    const rootX = t * 18;
    const wave = Math.sin(phase * 2 + i * 0.7);
    const tipX = t * 28 + wave * 3;
    const midX = (rootX + tipX) / 2 + Math.sin(phase * 1.6 + i) * 4;
    ctx.beginPath();
    ctx.moveTo(rootX, 14);
    ctx.quadraticCurveTo(midX, 24, tipX, 34 + wave * 1.5);
    ctx.stroke();
  }
  // Two longer feeding arms on the outer edges
  ctx.strokeStyle = "#b196ff";
  for (const sign of [-1, 1] as const) {
    const wave = Math.sin(phase * 1.8 + sign);
    ctx.beginPath();
    ctx.moveTo(sign * 9, 14);
    ctx.quadraticCurveTo(sign * 18 + wave * 3, 30, sign * 22 + wave * 4, 46);
    ctx.stroke();
  }

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
  const lastEmitRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    const W = canvas.width;
    const H = canvas.height;
    const surfaceY = 36;
    const maxDepthPx = H - surfaceY - 40;
    const maxDepthM = 1000;

    let prevSquidY = surfaceY;

    const draw = (now: number) => {
      ctx.clearRect(0, 0, W, H);

      // Sky above the surface
      const sky = ctx.createLinearGradient(0, 0, 0, surfaceY);
      sky.addColorStop(0, "#1b3b66");
      sky.addColorStop(1, "#2d6aa3");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, surfaceY);

      // Ocean gradient — lighter near surface, very dark in the abyss
      const sea = ctx.createLinearGradient(0, surfaceY, 0, H);
      sea.addColorStop(0, "#1a5b9a");
      sea.addColorStop(0.3, "#0b2d5c");
      sea.addColorStop(1, "#01030a");
      ctx.fillStyle = sea;
      ctx.fillRect(0, surfaceY, W, H - surfaceY);

      // Subtle god-ray shimmer from the surface
      ctx.fillStyle = "rgba(120, 200, 230, 0.06)";
      for (let i = 0; i < 4; i++) {
        const cx = ((i + 0.5) * W) / 4 + Math.sin(now / 2200 + i) * 20;
        ctx.beginPath();
        ctx.moveTo(cx - 20, surfaceY);
        ctx.lineTo(cx + 20, surfaceY);
        ctx.lineTo(cx + 60, H);
        ctx.lineTo(cx - 60, H);
        ctx.closePath();
        ctx.fill();
      }

      // Surface ripples
      ctx.strokeStyle = "rgba(200, 230, 255, 0.25)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 4) {
        const y = surfaceY + Math.sin((x + now / 60) / 22) * 2;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Depth labels on the right edge
      ctx.fillStyle = "rgba(180, 220, 240, 0.35)";
      ctx.font = "10px Rubik, sans-serif";
      ctx.textAlign = "right";
      for (const m of [100, 250, 500, 750, 1000]) {
        const y = surfaceY + (m / maxDepthM) * maxDepthPx;
        ctx.fillText(`${m}m`, W - 6, y);
        ctx.strokeStyle = "rgba(120, 200, 230, 0.08)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W - 34, y);
        ctx.stroke();
      }
      ctx.textAlign = "start";

      // Squid target + current position
      const cx = W / 2;
      let squidY = surfaceY;
      let speed = 0;
      if (distance != null) {
        const targetY = surfaceY + (Math.min(distance, maxDepthM) / maxDepthM) * maxDepthPx;
        if (animating) {
          if (!startRef.current) startRef.current = now;
          const tNorm = Math.min(1, (now - startRef.current) / 1600);
          const eased = 1 - Math.pow(1 - tNorm, 3);
          squidY = surfaceY + eased * (targetY - surfaceY);
          if (tNorm >= 1) {
            startRef.current = 0;
            onAnimDone();
          }
        } else {
          squidY = targetY;
        }
      }
      speed = squidY - prevSquidY;
      prevSquidY = squidY;

      // Bubble trail — emit while moving, they rise toward the surface
      if (animating && speed > 0.5 && now - lastEmitRef.current > 40) {
        lastEmitRef.current = now;
        bubblesRef.current.push({
          x: cx + (Math.random() - 0.5) * 18,
          y: squidY - 6,
          r: 1 + Math.random() * 2.5,
          vy: -0.4 - Math.random() * 0.8,
          life: 80 + Math.random() * 40,
        });
      }
      const bubbles = bubblesRef.current;
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i];
        b.x += Math.sin(now / 400 + b.y / 30) * 0.2;
        b.y += b.vy;
        b.life -= 1;
        if (b.life <= 0 || b.y < surfaceY - 4) bubbles.splice(i, 1);
      }
      ctx.fillStyle = "rgba(200, 230, 255, 0.55)";
      for (const b of bubbles) {
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Squid (phase ticks with real time so it keeps undulating on idle)
      const phase = now / 140;
      drawSquid(ctx, cx, squidY, phase, Math.max(0, speed));

      // Settled distance marker
      if (distance != null && !animating) {
        ctx.fillStyle = "#e8f0ff";
        ctx.font = "14px Rubik, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`${distance} m`, cx, squidY + 60);
        ctx.textAlign = "start";
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
    }
  }, [animating]);

  return (
    <div className="dive-canvas-wrap">
      <canvas ref={canvasRef} width={480} height={560} className="dive-canvas" />
    </div>
  );
}

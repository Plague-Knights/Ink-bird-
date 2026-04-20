"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatEther, parseEther, toHex } from "viem";
import type { SimInput } from "@/lib/simulate";
import { ConnectWallet } from "@/components/ConnectWallet";
import { Game } from "@/components/Game";
import { useAuth } from "@/lib/useSession";

type Phase = "idle" | "opening" | "cannon" | "playing" | "settling" | "done";

type OpenResponse = { roundId: string; seedHash: `0x${string}`; simSeed: number };
type SettleResponse = {
  roundId: string;
  seedHash: `0x${string}`;
  seed: `0x${string}`;
  userSalt: `0x${string}`;
  score: number;
  framesRun: number;
  betWei: string;
  payoutWei: string;
  balanceWei: string;
};

const CANNON_ANIM_MS = 1800;

function randSalt(): `0x${string}` {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return toHex(buf);
}

export default function LaunchPage() {
  const { signedIn, loaded } = useAuth();
  const [balance, setBalance] = useState<bigint | null>(null);
  const [betStr, setBetStr] = useState<string>("0.01");
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [openResult, setOpenResult] = useState<OpenResponse | null>(null);
  const [result, setResult] = useState<SettleResponse | null>(null);

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

  const load = useCallback(async () => {
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
    setPhase("opening");
    try {
      const userSalt = randSalt();
      const res = await fetch("/api/launch/open", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userSalt, betWei: betWei.toString() }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Open failed");
      setOpenResult(j as OpenResponse);
      setBalance((prev) => (prev == null ? prev : prev - betWei));
      setPhase("cannon");
      window.setTimeout(() => setPhase("playing"), CANNON_ANIM_MS);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Open failed");
      setPhase("idle");
    }
  }, [betStr]);

  // Game handshake — resolve immediately with the sim seed we got at /open.
  const onBeforeStart = useCallback(async () => {
    if (!openResult) return null;
    return { attemptId: openResult.roundId, seed: openResult.simSeed };
  }, [openResult]);

  const onGameOver = useCallback(
    async (payload: { attemptId: string; seed: number; inputs: SimInput[]; claimedScore: number }) => {
      setPhase("settling");
      try {
        const res = await fetch("/api/launch/settle", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            roundId: payload.attemptId,
            inputs: payload.inputs,
            claimedScore: payload.claimedScore,
          }),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error ?? "Settle failed");
        setResult(j as SettleResponse);
        setBalance(BigInt((j as SettleResponse).balanceWei));
        setPhase("done");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Settle failed");
        setPhase("idle");
      }
    },
    [],
  );

  if (!loaded) return <div className="wrap"><p>Loading...</p></div>;

  return (
    <div className="wrap">
      <div className="topbar">
        <h1>Squid Launch</h1>
        <ConnectWallet />
      </div>

      {!signedIn ? (
        <div className="panel">
          <p>Sign in to play the launcher prototype.</p>
        </div>
      ) : (
        <>
          {(phase === "playing" || phase === "settling" || phase === "done") && openResult ? (
            <div className="game-col">
              <Game
                canStart={true}
                onBeforeStart={onBeforeStart}
                onGameOver={onGameOver}
              />
            </div>
          ) : phase === "cannon" ? (
            <CannonIntro />
          ) : null}

          {(phase === "idle" || phase === "done") && (
            <div className="panel">
              <div className="panel-row">
                <div className="stat">
                  <span>Balance</span>
                  <b>{balance == null ? "..." : `${Number(formatEther(balance)).toFixed(4)} tETH`}</b>
                </div>
                <button className="icon-btn" onClick={faucet} type="button">
                  + 0.1 tETH FAUCET
                </button>
              </div>
            </div>
          )}

          {(phase === "idle" || phase === "done") && (
            <div className="panel">
              <h3 className="panel-title">Load the cannon</h3>
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
                  onClick={load}
                  type="button"
                >
                  {phase === "done" ? "AGAIN" : "LAUNCH"}
                </button>
              </div>
              {error && <p className="wallet-error">{error}</p>}
            </div>
          )}

          {phase === "done" && result && (
            <div className="panel">
              <h3 className="panel-title">Outcome</h3>
              <div className="panel-row">
                <div className="stat">
                  <span>Pipes</span>
                  <b>{result.score}</b>
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
                  <dt>Frames run</dt><dd>{result.framesRun}</dd>
                  <dt>Verify</dt>
                  <dd>
                    <a href={`/api/launch/verify/${result.roundId}`} target="_blank" rel="noreferrer">
                      /api/launch/verify/{result.roundId.slice(0, 10)}...
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

// 1.8-second cannon intro drawn in the same painterly canvas style as
// the main game. Pure procedural — no sprites — so it slots cleanly
// next to Game.tsx visually.
function CannonIntro() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const start = performance.now();
    const W = canvas.width;
    const H = canvas.height;

    const draw = (now: number) => {
      const t = Math.min(1, (now - start) / CANNON_ANIM_MS);
      ctx.clearRect(0, 0, W, H);

      // Background: dusk sky -> ocean gradient
      const grd = ctx.createLinearGradient(0, 0, 0, H);
      grd.addColorStop(0, "#1b3b66");
      grd.addColorStop(0.45, "#0c2a54");
      grd.addColorStop(1, "#020716");
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, W, H);

      // Water surface
      ctx.strokeStyle = "rgba(200,230,255,0.25)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 4) {
        const y = H * 0.65 + Math.sin((x + now / 40) / 22) * 2;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Cannon — wooden barrel + iron bands + wheels. Anchored at
      // lower-left, muzzle points up-right at ~50°.
      const baseX = W * 0.18;
      const baseY = H * 0.72;
      const angle = -Math.PI / 3; // -60° from horizontal, muzzle pointing up-right
      ctx.save();
      ctx.translate(baseX, baseY);
      // Carriage
      ctx.fillStyle = "#2a1a0c";
      ctx.fillRect(-55, -8, 110, 22);
      // Wheels
      ctx.fillStyle = "#1a0f07";
      ctx.beginPath(); ctx.arc(-40, 20, 18, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(40, 20, 18, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#3b2816"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(-40, 20, 18, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(40, 20, 18, 0, Math.PI * 2); ctx.stroke();
      // Barrel
      ctx.save();
      ctx.rotate(angle);
      const barrelGrd = ctx.createLinearGradient(0, -14, 0, 14);
      barrelGrd.addColorStop(0, "#6e4423");
      barrelGrd.addColorStop(0.5, "#4a2a13");
      barrelGrd.addColorStop(1, "#2a1708");
      ctx.fillStyle = barrelGrd;
      ctx.fillRect(0, -14, 90, 28);
      // Iron bands
      ctx.fillStyle = "#141414";
      for (const bx of [12, 40, 68]) ctx.fillRect(bx, -15, 4, 30);
      // Muzzle ring
      ctx.fillStyle = "#0a0a0a";
      ctx.fillRect(86, -16, 6, 32);
      ctx.restore();
      ctx.restore();

      // Muzzle flash — brightest right at launch (t around 0.15..0.35)
      const flashT = (t - 0.15) / 0.2;
      if (flashT > 0 && flashT < 1) {
        const flashAlpha = 1 - flashT;
        const mx = baseX + Math.cos(angle) * 92;
        const my = baseY + Math.sin(angle) * 92;
        const radGrad = ctx.createRadialGradient(mx, my, 4, mx, my, 90);
        radGrad.addColorStop(0, `rgba(255,230,130,${0.9 * flashAlpha})`);
        radGrad.addColorStop(0.4, `rgba(255,140,60,${0.6 * flashAlpha})`);
        radGrad.addColorStop(1, `rgba(255,80,20,0)`);
        ctx.fillStyle = radGrad;
        ctx.fillRect(mx - 90, my - 90, 180, 180);
      }

      // Squid in flight — only shown after t > ~0.18
      if (t > 0.18) {
        const shotT = (t - 0.18) / 0.82;
        // Ballistic arc: straight from muzzle going up-right, parabolic peak
        const startMx = baseX + Math.cos(angle) * 92;
        const startMy = baseY + Math.sin(angle) * 92;
        const targetX = W * 1.05;
        const targetY = H * 0.1;
        const x = startMx + (targetX - startMx) * shotT;
        // Parabola peak at shotT=0.5
        const arcH = H * 0.45;
        const y = startMy + (targetY - startMy) * shotT - 4 * arcH * shotT * (1 - shotT);

        // Squid body (matches the game's simple silhouette)
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(-Math.PI / 4 + shotT * 0.9);
        ctx.fillStyle = "#8b6cff";
        ctx.beginPath();
        ctx.ellipse(0, 0, 18, 12, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#02061a";
        ctx.beginPath();
        ctx.arc(-4, -2, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(-3.3, -2.8, 1, 0, Math.PI * 2);
        ctx.fill();
        // Trailing tentacles
        ctx.strokeStyle = "#6b53c7";
        ctx.lineWidth = 2;
        for (let i = -3; i <= 3; i++) {
          ctx.beginPath();
          ctx.moveTo(14, i * 1.2);
          ctx.quadraticCurveTo(24, i * 2, 30 + Math.sin(now / 80 + i) * 2, i * 2.5);
          ctx.stroke();
        }
        ctx.restore();

        // Smoke trail
        for (let k = 0; k < 6; k++) {
          const trailT = shotT - k * 0.02;
          if (trailT <= 0) continue;
          const tx = startMx + (targetX - startMx) * trailT;
          const ty = startMy + (targetY - startMy) * trailT - 4 * arcH * trailT * (1 - trailT);
          ctx.fillStyle = `rgba(200,200,220,${0.25 * (1 - k / 6)})`;
          ctx.beginPath();
          ctx.arc(tx, ty, 6 + k * 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      if (t < 1) {
        raf = requestAnimationFrame(draw);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="dive-canvas-wrap">
      <canvas ref={canvasRef} width={480} height={640} className="dive-canvas launch-intro-canvas" />
    </div>
  );
}

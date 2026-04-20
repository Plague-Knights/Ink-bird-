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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    const draw = (now: number) => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // Ocean gradient
      const grd = ctx.createLinearGradient(0, 0, 0, h);
      grd.addColorStop(0, "#061a36");
      grd.addColorStop(1, "#020716");
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, w, h);

      // Depth ticks at 100-meter marks, mapping 0..1000m -> left..right
      ctx.strokeStyle = "rgba(120,200,230,0.15)";
      ctx.lineWidth = 1;
      for (let m = 100; m <= 1000; m += 100) {
        const x = (m / 1000) * w;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }

      // Squid position
      let squidX = 20;
      if (distance != null && animating) {
        if (!startRef.current) startRef.current = now;
        const tNorm = Math.min(1, (now - startRef.current) / 1200);
        const eased = 1 - Math.pow(1 - tNorm, 3);
        squidX = 20 + eased * ((Math.min(distance, 1000) / 1000) * (w - 40));
        if (tNorm >= 1) {
          startRef.current = 0;
          onAnimDone();
        }
      } else if (distance != null) {
        squidX = 20 + (Math.min(distance, 1000) / 1000) * (w - 40);
      }
      const squidY = h / 2;

      // trail
      ctx.strokeStyle = "rgba(95,216,255,0.35)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(20, squidY);
      ctx.lineTo(squidX, squidY);
      ctx.stroke();

      // squid body
      ctx.fillStyle = "#5fd8ff";
      ctx.beginPath();
      ctx.arc(squidX, squidY, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#021629";
      ctx.beginPath();
      ctx.arc(squidX - 2, squidY - 2, 2, 0, Math.PI * 2);
      ctx.fill();

      // distance marker
      if (distance != null) {
        ctx.fillStyle = "#e8f0ff";
        ctx.font = "14px Rubik, sans-serif";
        ctx.fillText(`${distance} m`, squidX + 12, squidY + 4);
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [distance, animating, onAnimDone]);

  useEffect(() => {
    if (animating) startRef.current = 0;
  }, [animating]);

  return (
    <div className="dive-canvas-wrap">
      <canvas ref={canvasRef} width={960} height={180} className="dive-canvas" />
    </div>
  );
}

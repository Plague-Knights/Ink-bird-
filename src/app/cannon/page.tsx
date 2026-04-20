"use client";

import { useCallback, useEffect, useState } from "react";
import { keccak256, formatEther, parseEther, toHex } from "viem";
import { ConnectWallet } from "@/components/ConnectWallet";
import { CannonCanvas } from "@/components/CannonCanvas";
import { useAuth } from "@/lib/useSession";

const ANGLE_MIN = 20;
const ANGLE_MAX = 80;
const ANGLE_STEP = 5;

type CannonEvent =
  | { kind: "blot"; value: number }
  | { kind: "hazard" };

type PlayResult = {
  roundId: string;
  seedHash: `0x${string}`;
  seed: `0x${string}`;
  userSalt: `0x${string}`;
  outcomeIndex: number;
  events: CannonEvent[];
  totalMultiplierBps: number;
  betWei: string;
  payoutWei: string;
  balanceWei: string;
};

function randSalt(): `0x${string}` {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return toHex(buf);
}

export default function CannonPage() {
  const { signedIn, loaded } = useAuth();
  const [balance, setBalance] = useState<bigint | null>(null);
  const [betStr, setBetStr] = useState<string>("0.01");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PlayResult | null>(null);
  const [result, setResult] = useState<PlayResult | null>(null);
  const [animating, setAnimating] = useState(false);
  const [liveMultBps, setLiveMultBps] = useState(0);
  const [angleDeg, setAngleDeg] = useState<number>(45);

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

  const nudgeAngle = useCallback((delta: number) => {
    setAngleDeg((a) => Math.max(ANGLE_MIN, Math.min(ANGLE_MAX, a + delta)));
  }, []);

  const launch = useCallback(async () => {
    setError(null);
    setResult(null);
    setPending(null);
    setLiveMultBps(0);
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
      const openRes = await fetch("/api/cannon/open", { method: "POST" });
      const openJson = await openRes.json();
      if (!openRes.ok) throw new Error(openJson.error ?? "Open failed");
      const roundId = openJson.roundId as string;
      const committedHash = openJson.seedHash as `0x${string}`;

      const userSalt = randSalt();
      const playRes = await fetch("/api/cannon/play", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roundId, userSalt, betWei: betWei.toString() }),
      });
      const playJson = await playRes.json();
      if (!playRes.ok) throw new Error(playJson.error ?? "Play failed");

      const reveal: PlayResult = playJson;
      const recomputed = keccak256(reveal.seed);
      if (recomputed.toLowerCase() !== committedHash.toLowerCase()) {
        throw new Error("Seed reveal does not match commit, refusing outcome");
      }

      setAnimating(true);
      setPending(reveal);
      setBalance(BigInt(reveal.balanceWei));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Launch failed");
    } finally {
      setBusy(false);
    }
  }, [betStr]);

  if (!loaded) {
    return <div className="wrap"><p>Loading...</p></div>;
  }

  const multX = (liveMultBps / 10000).toFixed(2);
  const canInteract = !animating && !busy;

  return (
    <div className="wrap">
      <div className="topbar">
        <h1>Squid Cannon</h1>
        <ConnectWallet />
      </div>

      {!signedIn ? (
        <div className="panel">
          <p>Sign in to play the cannon prototype.</p>
        </div>
      ) : (
        <>
          <div className="cannon-stage">
            {/* Angle picker overlaid at the top of the canvas. Up raises the
                barrel (steeper arc), Down flattens. Matches Moonsheep's
                single-column UX. */}
            <div className="cannon-angle-bar">
              <button
                className="icon-btn cannon-angle-btn"
                onClick={() => nudgeAngle(ANGLE_STEP)}
                disabled={!canInteract}
                type="button"
                aria-label="Angle up"
              >
                ▲
              </button>
              <div className="cannon-angle-disc">
                <span>ANGLE</span>
                <b>{angleDeg}°</b>
              </div>
              <button
                className="icon-btn cannon-angle-btn"
                onClick={() => nudgeAngle(-ANGLE_STEP)}
                disabled={!canInteract}
                type="button"
                aria-label="Angle down"
              >
                ▼
              </button>
            </div>

            <CannonCanvas
              events={pending?.events ?? result?.events ?? null}
              animating={animating}
              angleDeg={angleDeg}
              onAnimDone={() => {
                setAnimating(false);
                if (pending) {
                  setResult(pending);
                  setPending(null);
                }
              }}
              onMultiplierUpdate={setLiveMultBps}
            />

            {animating && (
              <div className="cannon-hud">
                <span>x{multX}</span>
              </div>
            )}

            {/* Bet + launch pinned to the bottom of the canvas stage,
                Moonsheep-style. */}
            <div className="cannon-betbar">
              <div className="cannon-balance">
                <span>tETH</span>
                <b>{balance == null ? "…" : Number(formatEther(balance)).toFixed(4)}</b>
                <button className="icon-btn" onClick={faucet} type="button" disabled={!canInteract}>
                  +
                </button>
              </div>
              <input
                className="week-input cannon-bet-input"
                inputMode="decimal"
                value={betStr}
                onChange={(e) => setBetStr(e.target.value)}
                placeholder="Bet"
              />
              <button
                className="big-btn cannon-launch-btn"
                onClick={launch}
                disabled={!canInteract}
                type="button"
              >
                {busy ? "…" : "LAUNCH"}
              </button>
            </div>
            {error && <p className="wallet-error cannon-error">{error}</p>}
          </div>

          {result && (
            <div className="panel">
              <h3 className="panel-title">Outcome</h3>
              <div className="panel-row">
                <div className="stat">
                  <span>Multiplier</span>
                  <b>x{(result.totalMultiplierBps / 10000).toFixed(2)}</b>
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
                  <dt>Blots hit</dt><dd>{result.events.filter((e) => e.kind === "blot").length}</dd>
                  <dt>Verify</dt>
                  <dd>
                    <a href={`/api/cannon/verify/${result.roundId}`} target="_blank" rel="noreferrer">
                      /api/cannon/verify/{result.roundId.slice(0, 10)}...
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

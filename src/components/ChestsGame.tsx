"use client";

import { useEffect, useMemo, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useChainId, useSwitchChain, useWriteContract, useReadContract, useWaitForTransactionReceipt } from "wagmi";
import { formatEther, parseEther, toHex } from "viem";
import { GAME_ABI, gameAddressForChain, explorerForGameChain, supportedGameChains } from "@/lib/gameContract";
import { AutoFlapper, type TurboLevel } from "@/components/AutoFlapper";
import { ChestReveal } from "@/components/ChestReveal";

// Only list chains that actually have an InkSquidGame deployed (env
// var set). A chain with no deploy stays hidden from the wallet
// switcher so players don't pick it and land on "no contract" —
// they just don't see it as an option.
const SUPPORTED_CHAINS = supportedGameChains();

type RoundStatus =
  | { status: "idle" }
  | { status: "opening" }
  | { status: "awaiting_play" }
  | { status: "revealing" }
  | {
      status: "resolved";
      betWei: string;
      payoutWei: string;
      multiplierThousandths: number;
      txReveal?: string;
    }
  | {
      // Round didn't resolve in the reveal window; player got their
      // bet back 1× via the on-chain claimTimeout path.
      status: "refunded";
      betWei: string;
      refundWei: string;
      txRefund?: string;
    }
  | { status: "error"; error: string };

const POLL_MS = 2500;

export function ChestsGame() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending: switching } = useSwitchChain();
  const GAME_ADDRESS = gameAddressForChain(chainId);
  const unsupportedChain = isConnected && !GAME_ADDRESS;

  const [round, setRound] = useState<RoundStatus>({ status: "idle" });
  const [seedHash, setSeedHash] = useState<string | null>(null);
  const [visualSeed, setVisualSeed] = useState<number>(0);
  const [turbo, setTurbo] = useState<TurboLevel>("off");
  // Demo mode — lets visitors try the chests flow without a wallet or
  // on-chain transaction. Client-only roll on the same 7-band curve.
  const [demoMode, setDemoMode] = useState(true);
  const [betInput, setBetInput] = useState<string>(""); // empty → defaults to max

  const readAddress = GAME_ADDRESS ?? undefined;
  const enabledRead = !!readAddress;
  const { data: minBet } = useReadContract({
    address: readAddress, abi: GAME_ABI, functionName: "minBet",
    query: { enabled: enabledRead },
  });
  const { data: maxBet } = useReadContract({
    address: readAddress, abi: GAME_ABI, functionName: "maxBet",
    query: { enabled: enabledRead },
  });

  const { writeContract, data: playTxHash, error: writeErr, isPending: writing, reset } = useWriteContract();
  const { isLoading: confirming } = useWaitForTransactionReceipt({ hash: playTxHash });

  useEffect(() => {
    if (!seedHash) return;
    if (round.status === "resolved" || round.status === "refunded"
        || round.status === "error" || round.status === "idle") return;
    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/game/round/${seedHash}?chain=${chainId}`);
        if (!res.ok) return;
        const body = await res.json();
        if (body.status === "resolved") {
          setRound({
            status: "resolved",
            betWei: body.betWei,
            payoutWei: body.payoutWei,
            multiplierThousandths: body.multiplierThousandths,
            txReveal: body.txReveal,
          });
        } else if (body.status === "refunded") {
          setRound({
            status: "refunded",
            betWei: body.betWei,
            refundWei: body.refundWei,
            txRefund: body.txRefund,
          });
        } else if (body.status === "revealing") {
          setRound(prev => prev.status === "revealing" ? prev : { status: "revealing" });
        } else if (body.status === "stuck") {
          setRound({ status: "error", error: body.reason ?? "round stuck" });
        }
      } catch {}
    }, POLL_MS);
    return () => clearInterval(id);
  }, [seedHash, round.status, chainId]);

  // Clamp the bet to the contract bounds. Empty input → default to max.
  const effectiveBetWei = useMemo(() => {
    if (minBet == null || maxBet == null) return null;
    const min = minBet as bigint;
    const max = maxBet as bigint;
    if (!betInput) return max;
    let parsed: bigint;
    try { parsed = parseEther(betInput); } catch { return null; }
    if (parsed < min) return min;
    if (parsed > max) return max;
    return parsed;
  }, [betInput, minBet, maxBet]);

  // Client-only demo roll on the same 7-band curve the contract uses.
  function playDemo() {
    setVisualSeed(Math.floor(Math.random() * 0xffffffff));
    const bands = [
      { w: 80,  m: 0,    min: 0,    max: 0    }, // BUST 8%
      { w: 150, m: 700,  min: 700,  max: 700  },
      { w: 300, m: 900,  min: 900,  max: 900  },
      { w: 300, m: 1050, min: 1050, max: 1050 },
      { w: 140, m: 1200, min: 1200, max: 1200 },
      { w: 25,  m: 1800, min: 1800, max: 1800 },
      { w: 5,   m: 5000, min: 5000, max: 5000 }, // 5x jackpot 0.5%
    ];
    const total = bands.reduce((a, b) => a + b.w, 0);
    let pick = Math.random() * total;
    let band = bands[0]!;
    for (const b of bands) {
      if (pick < b.w) { band = b; break; }
      pick -= b.w;
    }
    const demoBet = 10_000_000_000_000_000n; // 0.01 ETH placeholder
    const multiplierThousandths = band.m;
    const payoutWei = (demoBet * BigInt(multiplierThousandths)) / 1000n;
    setRound({ status: "awaiting_play" });
    // Hold "awaiting" briefly so the visual flow matches the real one,
    // then resolve. AutoFlapper runs its whole run regardless; the
    // result card is what players actually watch for.
    setTimeout(() => {
      setRound({
        status: "resolved",
        betWei: String(demoBet),
        payoutWei: String(payoutWei),
        multiplierThousandths,
      });
    }, 500);
  }

  async function play() {
    if (demoMode) { playDemo(); return; }
    if (!isConnected || !GAME_ADDRESS || effectiveBetWei == null) return;
    setRound({ status: "opening" });
    try {
      const res = await fetch(`/api/game/open?chain=${chainId}`, { method: "POST" });
      if (!res.ok) throw new Error(`open: ${res.status}`);
      const body = await res.json();
      const hash = body.serverSeedHash as `0x${string}`;
      // Generate playerSeed client-side — load-bearing for provably-fair.
      // The server never sees it before the on-chain commit, so even a
      // compromised server can't grind outcomes alongside a target
      // address.
      const buf = new Uint8Array(32);
      crypto.getRandomValues(buf);
      const playerSeed = toHex(buf);
      setSeedHash(hash);
      setVisualSeed(Math.floor(Math.random() * 0xffffffff));
      setRound({ status: "awaiting_play" });
      writeContract({
        address: GAME_ADDRESS,
        abi: GAME_ABI,
        functionName: "play",
        args: [hash, playerSeed],
        value: effectiveBetWei,
      });
    } catch (e) {
      setRound({ status: "error", error: (e as Error).message });
    }
  }

  useEffect(() => {
    if (writeErr) {
      setRound({ status: "error", error: writeErr.message });
      reset();
    }
  }, [writeErr, reset]);

  function resetForNextPlay() {
    setSeedHash(null);
    setRound({ status: "idle" });
    reset();
  }

  const minBetEth = minBet != null ? formatEther(minBet as bigint) : "—";
  const maxBetEth = maxBet != null ? formatEther(maxBet as bigint) : "—";
  const effectiveBetEth = effectiveBetWei != null ? formatEther(effectiveBetWei) : "—";

  const buttonLabel = (() => {
    if (!demoMode && writing)    return "Confirm in wallet…";
    if (!demoMode && confirming) return "Submitting play…";
    switch (round.status) {
      case "opening":      return "Opening round…";
      case "awaiting_play":return demoMode ? "Playing…" : "Awaiting play tx…";
      case "revealing":    return "Resolving on-chain…";
      case "resolved":     return demoMode ? "Play again (DEMO)" : "Play again";
      case "refunded":     return "Play again";
      case "error":        return "Try again";
      default:             return demoMode
        ? "PLAY (DEMO)"
        : `Play (${Number(effectiveBetEth).toFixed(4)} ETH)`;
    }
  })();

  const buttonDisabled = demoMode
    ? round.status === "awaiting_play"
    : (!isConnected || unsupportedChain || writing || confirming
      || round.status === "opening" || round.status === "awaiting_play" || round.status === "revealing"
      || effectiveBetWei == null);

  const onButtonClick =
    round.status === "resolved" || round.status === "refunded" || round.status === "error"
      ? resetForNextPlay
      : play;

  // Hamburger-drawer state for the info panel.
  return <ChestsGameUI {...{
    round, demoMode, setDemoMode, resetForNextPlay,
    visualSeed, turbo, setTurbo,
    betInput, setBetInput, effectiveBetWei, effectiveBetEth,
    minBet, maxBet, minBetEth, maxBetEth,
    isConnected, unsupportedChain, chainId, switchChain, switching,
    buttonLabel, buttonDisabled, onButtonClick,
  }} />;
}

type UIProps = {
  round: RoundStatus;
  demoMode: boolean;
  setDemoMode: (v: boolean) => void;
  resetForNextPlay: () => void;
  visualSeed: number;
  turbo: TurboLevel;
  setTurbo: (v: TurboLevel) => void;
  betInput: string;
  setBetInput: (v: string) => void;
  effectiveBetWei: bigint | null;
  effectiveBetEth: string;
  minBet: unknown;
  maxBet: unknown;
  minBetEth: string;
  maxBetEth: string;
  isConnected: boolean;
  unsupportedChain: boolean | undefined;
  chainId: number | undefined;
  switchChain: ReturnType<typeof useSwitchChain>["switchChain"];
  switching: boolean;
  buttonLabel: string;
  buttonDisabled: boolean;
  onButtonClick: () => void;
};

function ChestsGameUI(p: UIProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  // Chest reveal state: we wait until BOTH the round has resolved AND
  // the AutoFlapper bird has died (so the player's dopamine build-up
  // peaks at the end of the run, not mid-flight).
  const [runChests, setRunChests] = useState<number | null>(null);
  const [revealDismissed, setRevealDismissed] = useState(false);
  const {
    round, demoMode, setDemoMode, resetForNextPlay,
    visualSeed, turbo, setTurbo,
    betInput, setBetInput, effectiveBetWei, effectiveBetEth,
    maxBet, minBetEth, maxBetEth,
    isConnected, unsupportedChain, chainId, switchChain, switching,
    buttonLabel, buttonDisabled, onButtonClick,
  } = p;

  // Reset reveal state whenever a new round starts (or we exit resolved).
  useEffect(() => {
    if (round.status !== "resolved") {
      setRunChests(null);
      setRevealDismissed(false);
    }
  }, [round.status, visualSeed]);

  const showReveal = round.status === "resolved" && runChests !== null && !revealDismissed;

  // Close drawer on Escape for keyboard users.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <div style={{
      position: "fixed", inset: 0,
      display: "flex", flexDirection: "column",
      background: "radial-gradient(ellipse 90% 60% at 50% 10%, #0a2540 0%, #031026 60%, #01060f 100%)",
      color: "#cfe7ff",
      fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    }}>
      {/* Top bar: brand · mode toggle · hamburger */}
      <header style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 14px",
        borderBottom: "1px solid rgba(127,227,255,0.12)",
        background: "rgba(2,14,30,0.8)",
        backdropFilter: "blur(8px)",
      }}>
        <a href="/" style={{
          display: "flex", alignItems: "center", gap: 8,
          color: "#fff", textDecoration: "none",
          fontWeight: 900, fontSize: 15, letterSpacing: "-0.01em",
        }}>
          🦑 <span>Ink Squid</span>
        </a>

        {/* Center: DEMO/REAL pill */}
        <div style={{
          display: "flex", gap: 0, padding: 3,
          background: "rgba(0,0,0,0.45)",
          border: `1px solid ${demoMode ? "rgba(255,215,106,0.35)" : "rgba(127,227,255,0.25)"}`,
          borderRadius: 999,
        }}>
          {(["demo", "real"] as const).map(m => {
            const active = (m === "demo") === demoMode;
            return (
              <button
                key={m}
                onClick={() => { setDemoMode(m === "demo"); resetForNextPlay(); }}
                style={{
                  padding: "6px 12px", border: "none", borderRadius: 999,
                  fontSize: 10, fontWeight: 800, letterSpacing: "0.14em",
                  cursor: "pointer",
                  background: active ? (m === "demo" ? "#ffd76a" : "#7fe3ff") : "transparent",
                  color: active ? "#021830" : "#7b94b8",
                }}
              >
                {m === "demo" ? "DEMO" : "REAL"}
              </button>
            );
          })}
        </div>

        {/* Right: hamburger — opens drawer with all detailed info */}
        <button
          onClick={() => setMenuOpen(true)}
          aria-label="Open info menu"
          style={{
            background: "rgba(127,227,255,0.08)",
            border: "1px solid rgba(127,227,255,0.25)",
            borderRadius: 10,
            width: 40, height: 38,
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", color: "#cfe7ff",
          }}
        >
          <svg width="18" height="14" viewBox="0 0 18 14" fill="none">
            <rect y="0"  width="18" height="2" rx="1" fill="currentColor" />
            <rect y="6"  width="18" height="2" rx="1" fill="currentColor" />
            <rect y="12" width="18" height="2" rx="1" fill="currentColor" />
          </svg>
        </button>
      </header>

      {/* Canvas stage — fills available space */}
      <div style={{
        position: "relative",
        flex: 1, minHeight: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "10px 14px",
        overflow: "hidden",
      }}>
        <div style={{ width: "100%", maxHeight: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: "min(100%, calc((100vh - 200px) * 480 / 640))" }}>
            <AutoFlapper
              seed={visualSeed || undefined}
              turbo={turbo}
              demo={round.status === "idle" || round.status === "error"}
              holdOnDeath={
                (round.status === "awaiting_play"
                  || round.status === "revealing"
                  || round.status === "resolved")
                && !revealDismissed
              }
              onRunEnd={n => { setRunChests(n); }}
            />
          </div>
        </div>

        {/* Chest reveal overlay — fires when the run has ended AND the
            round has resolved. Holds the bird dead, opens the collected
            chests one by one, and only then shows the final payout. */}
        {showReveal && round.status === "resolved" && (
          <ChestReveal
            multiplierThousandths={round.multiplierThousandths}
            betWei={round.betWei}
            payoutWei={round.payoutWei}
            chestsCollected={runChests ?? 0}
            txReveal={round.txReveal}
            explorerBase={explorerForGameChain(chainId)}
            onContinue={() => {
              setRevealDismissed(true);
              resetForNextPlay();
            }}
          />
        )}

        {/* Result card — overlay top-center on resolve (fallback only
            shown if the reveal has been dismissed and another round
            hasn't started yet). */}
        {round.status === "resolved" && revealDismissed && (
          <div className="cannon-result-reveal" style={{
            position: "absolute", left: "50%", top: 12,
            padding: "10px 18px",
            background: "rgba(2,24,48,0.85)",
            border: "1px solid rgba(127,227,255,0.4)",
            borderRadius: 12, color: "#cfe7ff",
            fontFamily: "ui-monospace, monospace", textAlign: "center",
            backdropFilter: "blur(8px)", minWidth: 220,
            boxShadow: "0 10px 40px rgba(127,227,255,0.2)",
            pointerEvents: "none",
          }}>
            <div style={{ fontSize: 11, opacity: 0.75 }}>
              {(round.multiplierThousandths / 1000).toFixed(2)}× multiplier
              {round.multiplierThousandths === 0 ? " · BUST" :
               round.multiplierThousandths >= 5000 ? " · JACKPOT" :
               round.multiplierThousandths >= 1800 ? " · big win" :
               round.multiplierThousandths >= 1200 ? " · solid" :
               round.multiplierThousandths >= 1000 ? " · win" : " · partial"}
            </div>
            <div style={{
              fontSize: 22, fontWeight: 800, marginTop: 2,
              color: BigInt(round.payoutWei) > BigInt(round.betWei) ? "#7fe3ff"
                : BigInt(round.payoutWei) > 0n ? "#ffb464"
                : "#ff8b8b",
            }}>
              {Number(formatEther(BigInt(round.payoutWei))).toFixed(6)} ETH
            </div>
            {round.txReveal && (
              <a href={`${explorerForGameChain(chainId)}/tx/${round.txReveal}`}
                 target="_blank" rel="noopener noreferrer"
                 style={{ fontSize: 10, opacity: 0.7, color: "#7fe3ff", display: "block", marginTop: 2, pointerEvents: "auto" }}>
                reveal tx ↗
              </a>
            )}
          </div>
        )}
        {/* Refunded — round didn't resolve in the reveal window. The
            on-chain claimTimeout refunded 1× bet. Show a small banner so
            the player understands what happened instead of hanging. */}
        {round.status === "refunded" && (
          <div style={{
            position: "absolute", left: "50%", top: 12, transform: "translateX(-50%)",
            padding: "10px 18px",
            background: "rgba(48,32,2,0.88)",
            border: "1px solid rgba(255,215,106,0.45)",
            borderRadius: 12, color: "#ffd76a",
            fontFamily: "ui-monospace, monospace", textAlign: "center", minWidth: 240,
            backdropFilter: "blur(8px)",
          }}>
            <div style={{ fontSize: 11, opacity: 0.85, letterSpacing: "0.14em", textTransform: "uppercase" }}>
              round timed out · refunded 1×
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, marginTop: 2 }}>
              {Number(formatEther(BigInt(round.refundWei))).toFixed(6)} ETH
            </div>
            {round.txRefund && (
              <a href={`${explorerForGameChain(chainId)}/tx/${round.txRefund}`}
                 target="_blank" rel="noopener noreferrer"
                 style={{ fontSize: 10, opacity: 0.8, color: "#ffd76a", display: "block", marginTop: 2 }}>
                refund tx ↗
              </a>
            )}
          </div>
        )}
        {round.status === "error" && (
          <div style={{
            position: "absolute", left: "50%", top: 12, transform: "translateX(-50%)",
            padding: "8px 14px",
            background: "rgba(40,0,0,0.85)",
            border: "1px solid rgba(255,116,116,0.45)",
            borderRadius: 10,
            color: "#ff8b8b", fontFamily: "ui-monospace, monospace", fontSize: 12,
          }}>
            {round.error.split("\n")[0]}
          </div>
        )}
      </div>

      {/* Compact dock: bet input (real only) · PLAY · turbo */}
      <div style={{
        display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap",
        padding: "10px 14px 14px",
        background: "linear-gradient(180deg, rgba(4,18,38,0.95) 0%, rgba(1,8,22,0.98) 100%)",
        borderTop: `1px solid ${demoMode ? "rgba(255,215,106,0.35)" : "rgba(127,227,255,0.2)"}`,
      }}>
        {!demoMode && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 140, flex: "0 1 180px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "#7b94b8" }}>
              <span>bet (eth)</span>
              <span style={{ color: "#cfe7ff" }}>{Number(effectiveBetEth).toFixed(5)}</span>
            </div>
            <input
              type="text"
              inputMode="decimal"
              placeholder={`max ${maxBetEth}`}
              value={betInput}
              onChange={e => setBetInput(e.target.value)}
              style={{
                background: "rgba(0,0,0,0.5)", border: "1px solid rgba(127,227,255,0.25)",
                color: "#cfe7ff", padding: "7px 9px", borderRadius: 7,
                fontFamily: "ui-monospace, monospace", fontSize: 12, outline: "none",
                width: "100%", boxSizing: "border-box",
              }}
            />
            <div style={{ display: "flex", gap: 4 }}>
              {[0.1, 0.25, 0.5].map(frac => (
                <button key={frac}
                  onClick={() => {
                    if (maxBet != null) setBetInput(formatEther(((maxBet as bigint) * BigInt(Math.round(frac * 1000))) / 1000n));
                  }}
                  style={presetBtnStyle}>
                  {Math.round(frac * 100)}%
                </button>
              ))}
              <button onClick={() => setBetInput("")} style={presetBtnStyle}>MAX</button>
            </div>
          </div>
        )}

        {/* Turbo pill — compact */}
        <div style={{
          display: "flex", gap: 0, padding: 3,
          background: "rgba(0,0,0,0.35)",
          border: "1px solid rgba(127,227,255,0.18)",
          borderRadius: 999,
        }}>
          {(["off", "on", "super"] as const).map(level => {
            const active = turbo === level;
            const tint = level === "super" ? "#ff7aa8" : level === "on" ? "#ffd76a" : "#7fe3ff";
            return (
              <button
                key={level}
                onClick={() => setTurbo(level)}
                style={{
                  padding: "6px 11px", border: "none", borderRadius: 999,
                  fontSize: 10, fontWeight: 800, letterSpacing: "0.14em",
                  cursor: "pointer",
                  background: active ? tint : "transparent",
                  color: active ? "#021830" : "#7b94b8",
                }}
              >
                {level === "off" ? "1×" : level === "on" ? "3×" : "7×"}
              </button>
            );
          })}
        </div>

        {/* PLAY button — takes the rest of the row */}
        <button
          onClick={onButtonClick}
          disabled={buttonDisabled}
          style={{
            ...btnStyle(demoMode ? "#ffd76a" : "#7fe3ff"),
            flex: "1 1 200px",
            padding: "14px 24px",
            fontSize: 15, fontWeight: 800, letterSpacing: "0.1em",
            boxShadow: demoMode
              ? "0 10px 30px rgba(255,215,106,0.35)"
              : "0 10px 30px rgba(127,227,255,0.3)",
          }}
        >
          {buttonLabel}
        </button>
      </div>

      {/* Hamburger drawer — slides from right with all the detail */}
      {menuOpen && (
        <>
          <div
            onClick={() => setMenuOpen(false)}
            style={{
              position: "fixed", inset: 0,
              background: "rgba(0,0,0,0.55)", backdropFilter: "blur(2px)",
              zIndex: 40,
            }}
          />
          <aside
            style={{
              position: "fixed", top: 0, right: 0, bottom: 0,
              width: "min(420px, 92vw)",
              background: "linear-gradient(180deg, #051428 0%, #020c1c 100%)",
              borderLeft: "1px solid rgba(127,227,255,0.22)",
              boxShadow: "-20px 0 60px rgba(0,0,0,0.5)",
              zIndex: 50,
              padding: "16px 18px",
              overflowY: "auto",
              display: "flex", flexDirection: "column", gap: 16,
              animation: "drawer-in 240ms cubic-bezier(0.2, 0.9, 0.3, 1) both",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 10, letterSpacing: "0.22em", color: "#7fe3ff", textTransform: "uppercase" }}>
                info
              </div>
              <button
                onClick={() => setMenuOpen(false)}
                aria-label="Close"
                style={{
                  background: "transparent", border: "none", color: "#7b94b8",
                  cursor: "pointer", fontSize: 22, lineHeight: 1, padding: "4px 8px",
                }}
              >
                ×
              </button>
            </div>

            {/* How it works */}
            <section style={{
              padding: "14px 16px",
              background: "rgba(127,227,255,0.05)",
              border: "1px solid rgba(127,227,255,0.15)",
              borderRadius: 12,
              lineHeight: 1.55, fontSize: 13,
            }}>
              <div style={{ fontSize: 10, opacity: 0.7, letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 6 }}>
                how it works
              </div>
              The squid auto-flies through a random run while the contract rolls <b>one</b> commit-reveal outcome on-chain.
              The chests mid-flight are visual flavor. <b>Payout is the multiplier the contract lands on</b>,
              paid as bet × multiplier on reveal. 92.8% RTP, 8% house edge.
            </section>

            {/* Payout table */}
            {(() => {
              const tableBet = effectiveBetWei ?? (demoMode ? 10_000_000_000_000_000n : null);
              if (tableBet == null) return null;
              return (
                <section style={{
                  padding: "14px 16px",
                  background: "rgba(127,227,255,0.05)",
                  border: "1px solid rgba(127,227,255,0.18)",
                  borderRadius: 12, color: "#cfe7ff",
                  fontFamily: "ui-monospace, monospace", fontSize: 12,
                }}>
                  <div style={{
                    display: "flex", justifyContent: "space-between", alignItems: "baseline",
                    fontSize: 10, opacity: 0.75, marginBottom: 8,
                    letterSpacing: "0.16em", textTransform: "uppercase",
                  }}>
                    <span>outcome</span><span>odds</span><span>you&rsquo;d get</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "5px 12px" }}>
                    {[
                      { label: "BUST",  pct: "8%",   mult: 0,    color: "#ff7474" },
                      { label: "0.7×",  pct: "15%",  mult: 700,  color: "#ff9b5a" },
                      { label: "0.9×",  pct: "30%",  mult: 900,  color: "#ffb464" },
                      { label: "1.05×", pct: "30%",  mult: 1050, color: "#cfe7ff" },
                      { label: "1.2×",  pct: "14%",  mult: 1200, color: "#cfd8dc" },
                      { label: "1.8×",  pct: "2.5%", mult: 1800, color: "#ffd76a" },
                      { label: "5× JACKPOT", pct: "0.5%", mult: 5000, color: "#7fe3ff" },
                    ].map(row => {
                      const payout = (tableBet * BigInt(row.mult)) / 1000n;
                      return (
                        <div key={row.label} style={{ display: "contents" }}>
                          <span style={{ color: row.color, fontWeight: 700 }}>{row.label}</span>
                          <span style={{ textAlign: "center", color: "#7b94b8" }}>{row.pct}</span>
                          <span style={{ textAlign: "right" }}>{Number(formatEther(payout)).toFixed(5)}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ marginTop: 8, fontSize: 10, color: "#7b94b8", textAlign: "right" }}>
                    {demoMode
                      ? "payouts shown for a 0.01 eth bet"
                      : `bet ${Number(effectiveBetEth).toFixed(5)} eth · min ${Number(minBetEth).toFixed(4)} · max ${Number(maxBetEth).toFixed(4)} · RTP 92.8%`}
                  </div>
                </section>
              );
            })()}

            {/* Wallet + chain (real mode only) */}
            {!demoMode && (
              <section style={{
                display: "flex", flexDirection: "column", gap: 10,
                padding: "14px 16px",
                background: "rgba(127,227,255,0.05)",
                border: "1px solid rgba(127,227,255,0.15)",
                borderRadius: 12,
              }}>
                <div style={{ fontSize: 10, opacity: 0.7, letterSpacing: "0.18em", textTransform: "uppercase" }}>
                  wallet &amp; chain
                </div>
                <ConnectButton chainStatus="icon" />
                {isConnected && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {SUPPORTED_CHAINS.map(c => (
                      <button key={c.id}
                        onClick={() => switchChain({ chainId: c.id })}
                        disabled={switching || chainId === c.id}
                        style={{
                          ...btnStyle(chainId === c.id ? "#7fe3ff" : "rgba(127,227,255,0.18)"),
                          color: chainId === c.id ? "#021830" : "#cfe7ff",
                          minWidth: 0, padding: "7px 12px", fontSize: 11,
                        }}>
                        {chainId === c.id ? "✓ " : ""}{c.name}
                      </button>
                    ))}
                  </div>
                )}
                {unsupportedChain && (
                  <div style={{ fontSize: 12, color: "#ff9b5a", fontFamily: "ui-monospace, monospace" }}>
                    no game contract deployed on this chain yet — try another
                  </div>
                )}
              </section>
            )}

            {/* Sibling game nav */}
            <a href="/preview" style={{
              padding: "12px 14px",
              background: "rgba(255,215,106,0.06)",
              border: "1px solid rgba(255,215,106,0.25)",
              borderRadius: 12,
              color: "#ffd76a",
              textDecoration: "none",
              display: "flex", justifyContent: "space-between", alignItems: "center",
              fontSize: 13,
            }}>
              <span>Try the Squid Cannon</span>
              <span style={{ fontSize: 18 }}>↗</span>
            </a>
          </aside>
        </>
      )}
    </div>
  );
}

function btnStyle(accent: string): React.CSSProperties {
  return {
    background: accent,
    color: "#021830",
    border: "none",
    borderRadius: 10,
    padding: "11px 22px",
    fontWeight: 700,
    fontSize: 14,
    fontFamily: "system-ui, sans-serif",
    cursor: "pointer",
    minWidth: 220,
  };
}

const presetBtnStyle: React.CSSProperties = {
  background: "rgba(127,227,255,0.12)",
  color: "#cfe7ff",
  border: "1px solid rgba(127,227,255,0.22)",
  borderRadius: 6,
  padding: "6px 10px",
  fontSize: 11,
  fontFamily: "ui-monospace, monospace",
  cursor: "pointer",
  flex: 1,
};

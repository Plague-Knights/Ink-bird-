"use client";

import { useEffect, useMemo, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useChainId, useSwitchChain, useWriteContract, useReadContract, useWaitForTransactionReceipt } from "wagmi";
import { formatEther, parseEther } from "viem";
import { CHESTS_ABI, chestsAddressForChain, explorerForChain } from "@/lib/chestsContract";
import { inkSepolia, soneiumMinato } from "@/config/chains";
import { AutoFlapper, type TurboLevel } from "@/components/AutoFlapper";

const SUPPORTED_CHAINS = [inkSepolia, soneiumMinato] as const;

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
  | { status: "error"; error: string };

const POLL_MS = 2500;

export function ChestsGame() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending: switching } = useSwitchChain();
  const CHESTS_ADDRESS = chestsAddressForChain(chainId);
  const unsupportedChain = isConnected && !CHESTS_ADDRESS;

  const [round, setRound] = useState<RoundStatus>({ status: "idle" });
  const [seedHash, setSeedHash] = useState<string | null>(null);
  const [visualSeed, setVisualSeed] = useState<number>(0);
  const [turbo, setTurbo] = useState<TurboLevel>("off");
  const [betInput, setBetInput] = useState<string>(""); // empty → defaults to max

  const readAddress = CHESTS_ADDRESS ?? undefined;
  const enabledRead = !!readAddress;
  const { data: minBet } = useReadContract({
    address: readAddress, abi: CHESTS_ABI, functionName: "minBet",
    query: { enabled: enabledRead },
  });
  const { data: maxBet } = useReadContract({
    address: readAddress, abi: CHESTS_ABI, functionName: "maxBet",
    query: { enabled: enabledRead },
  });

  const { writeContract, data: playTxHash, error: writeErr, isPending: writing, reset } = useWriteContract();
  const { isLoading: confirming } = useWaitForTransactionReceipt({ hash: playTxHash });

  useEffect(() => {
    if (!seedHash) return;
    if (round.status === "resolved" || round.status === "error" || round.status === "idle") return;
    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/chest/round/${seedHash}?chain=${chainId}`);
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

  async function play() {
    if (!isConnected || !CHESTS_ADDRESS || effectiveBetWei == null) return;
    setRound({ status: "opening" });
    try {
      const res = await fetch(`/api/chest/open?chain=${chainId}`, { method: "POST" });
      if (!res.ok) throw new Error(`open: ${res.status}`);
      const body = await res.json();
      const hash = body.seedHash as `0x${string}`;
      setSeedHash(hash);
      setVisualSeed(Math.floor(Math.random() * 0xffffffff));
      setRound({ status: "awaiting_play" });
      writeContract({
        address: CHESTS_ADDRESS,
        abi: CHESTS_ABI,
        functionName: "play",
        args: [hash],
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
    if (writing)    return "Confirm in wallet…";
    if (confirming) return "Submitting play…";
    switch (round.status) {
      case "opening":      return "Opening round…";
      case "awaiting_play":return "Awaiting play tx…";
      case "revealing":    return "Resolving on-chain…";
      case "resolved":     return "Play again";
      case "error":        return "Try again";
      default:             return `Play (${Number(effectiveBetEth).toFixed(4)} ETH)`;
    }
  })();

  const buttonDisabled = !isConnected || unsupportedChain || writing || confirming
    || round.status === "opening" || round.status === "awaiting_play" || round.status === "revealing"
    || effectiveBetWei == null;

  const onButtonClick = round.status === "resolved" || round.status === "error"
    ? resetForNextPlay
    : play;

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      gap: 16, width: "100%", maxWidth: 480, margin: "0 auto",
    }}>
      <div style={{
        width: "100%", display: "flex", justifyContent: "space-between",
        alignItems: "center", padding: "10px 14px", background: "rgba(120,200,255,0.05)",
        border: "1px solid rgba(120,200,255,0.15)", borderRadius: 12, fontFamily: "ui-monospace, monospace", fontSize: 12, color: "#cfe7ff",
      }}>
        <span>min <b>{Number(minBetEth).toFixed(4)} ETH</b></span>
        <span>max <b>{Number(maxBetEth).toFixed(4)} ETH</b></span>
        <span>RTP <b>92.8%</b></span>
      </div>

      <AutoFlapper
        seed={visualSeed || undefined}
        turbo={turbo}
        demo={round.status === "idle" || round.status === "error"}
      />

      <div style={{
        width: "100%", display: "flex", flexDirection: "column", gap: 8,
        padding: "12px 14px", background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(120,200,255,0.15)", borderRadius: 12,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#7b94b8" }}>
          <span>your bet</span>
          <span style={{ color: "#cfe7ff" }}>{Number(effectiveBetEth).toFixed(6)} ETH</span>
        </div>
        <input
          type="text"
          inputMode="decimal"
          placeholder={`0.01 (max ${maxBetEth} ETH)`}
          value={betInput}
          onChange={e => setBetInput(e.target.value)}
          style={{
            background: "rgba(0,0,0,0.35)", border: "1px solid rgba(120,200,255,0.22)",
            color: "#cfe7ff", padding: "8px 10px", borderRadius: 8,
            fontFamily: "ui-monospace, monospace", fontSize: 13, outline: "none",
          }}
        />
        <div style={{ display: "flex", gap: 6 }}>
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

      {/* Explainer — clarifies that the flying animation is just the
          visual, and the contract's single commit-reveal roll is what
          actually picks the outcome + payout. */}
      <div style={{
        width: "100%", padding: "12px 14px",
        background: "rgba(127,227,255,0.04)",
        border: "1px solid rgba(127,227,255,0.14)",
        borderRadius: 12, color: "#cfe7ff",
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif', fontSize: 12.5,
        lineHeight: 1.55,
      }}>
        <div style={{ fontSize: 10, opacity: 0.7, letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 6 }}>
          how it works
        </div>
        The squid auto-flies through a random run while the contract rolls <b>one</b>
        commit-reveal outcome on-chain. The chests you see mid-flight are the visual flavor;
        the <b>payout is the multiplier the contract lands on</b>, paid as bet × multiplier
        on reveal.
      </div>

      {effectiveBetWei != null && (
        <div style={{
          width: "100%", padding: "12px 14px",
          background: "rgba(127,227,255,0.04)",
          border: "1px solid rgba(127,227,255,0.18)",
          borderRadius: 12, color: "#cfe7ff",
          fontFamily: "ui-monospace, monospace", fontSize: 12,
        }}>
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "baseline",
            fontSize: 10, opacity: 0.75, marginBottom: 8,
            letterSpacing: "0.16em", textTransform: "uppercase",
          }}>
            <span>outcome</span>
            <span>odds</span>
            <span>you&rsquo;d get</span>
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
              const payout = (effectiveBetWei * BigInt(row.mult)) / 1000n;
              return (
                <div key={row.label} style={{ display: "contents" }}>
                  <span style={{ color: row.color, fontWeight: 700 }}>{row.label}</span>
                  <span style={{ textAlign: "center", color: "#7b94b8" }}>{row.pct}</span>
                  <span style={{ textAlign: "right" }}>{Number(formatEther(payout)).toFixed(5)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 3-tier speed pill — normal / turbo / super turbo */}
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
                padding: "7px 16px",
                border: "none",
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: "0.14em",
                cursor: "pointer",
                background: active ? tint : "transparent",
                color: active ? "#021830" : "#7b94b8",
                transition: "background 120ms ease-out, color 120ms ease-out",
              }}
            >
              {level === "off" ? "NORMAL" : level === "on" ? "TURBO" : "SUPER"}
            </button>
          );
        })}
      </div>

      {round.status === "resolved" && (
        <div style={{
          width: "100%", padding: "14px 18px",
          background: "rgba(127,227,255,0.08)",
          border: "1px solid rgba(127,227,255,0.3)",
          borderRadius: 12, color: "#cfe7ff", fontFamily: "ui-monospace, monospace",
          textAlign: "center",
        }}>
          <div style={{ fontSize: 13, opacity: 0.75, marginBottom: 4 }}>
            {(round.multiplierThousandths / 1000).toFixed(2)}× multiplier
            {round.multiplierThousandths === 0 ? " — bust" :
             round.multiplierThousandths >= 5000 ? " — JACKPOT" :
             round.multiplierThousandths >= 1800 ? " — big win" :
             round.multiplierThousandths >= 1200 ? " — solid win" :
             round.multiplierThousandths >= 1000 ? " — win" : " — partial"}
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color:
              BigInt(round.payoutWei) > BigInt(round.betWei) ? "#7fe3ff"
            : BigInt(round.payoutWei) > 0n ? "#ffb464"
            : "#ff8b8b" }}>
            {Number(formatEther(BigInt(round.payoutWei))).toFixed(6)} ETH
          </div>
          <div style={{ fontSize: 11, opacity: 0.55, marginTop: 4 }}>
            bet {Number(formatEther(BigInt(round.betWei))).toFixed(5)} ETH
          </div>
          {round.txReveal && (
            <a href={`${explorerForChain(chainId)}/tx/${round.txReveal}`}
               target="_blank" rel="noopener noreferrer"
               style={{ fontSize: 11, opacity: 0.6, color: "#7fe3ff", display: "block", marginTop: 4 }}>
              reveal tx ↗
            </a>
          )}
        </div>
      )}

      {round.status === "error" && (
        <div style={{ color: "#ff7474", fontFamily: "ui-monospace, monospace", fontSize: 13, textAlign: "center" }}>
          {round.error.split("\n")[0]}
        </div>
      )}

      <ConnectButton chainStatus="icon" />

      {isConnected && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
          {SUPPORTED_CHAINS.map((c) => (
            <button
              key={c.id}
              onClick={() => switchChain({ chainId: c.id })}
              disabled={switching || chainId === c.id}
              style={{
                ...btnStyle(chainId === c.id ? "#7fe3ff" : "rgba(127,227,255,0.18)"),
                color: chainId === c.id ? "#021830" : "#cfe7ff",
                minWidth: 0, padding: "8px 14px", fontSize: 12,
              }}
            >
              {chainId === c.id ? "✓ " : ""}{c.name}
            </button>
          ))}
        </div>
      )}
      {unsupportedChain && (
        <div style={{ fontSize: 12, color: "#ff9b5a", fontFamily: "ui-monospace, monospace" }}>
          switch to Ink Sepolia or Soneium Minato to play
        </div>
      )}

      <button onClick={onButtonClick} disabled={buttonDisabled} style={btnStyle("#7fe3ff")}>
        {buttonLabel}
      </button>
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

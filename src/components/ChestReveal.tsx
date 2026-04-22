"use client";

// Post-run chest opening reveal. Given the contract-determined payout
// multiplier and the count of chests the bird collected during its
// run, this component splits the multiplier across those chests and
// opens them one-by-one with a dopamine-tuned sequence: small pieces
// first, biggest saved for last, running total ticks up, then a final
// payout card drops in with a celebration.

import { useEffect, useState } from "react";
import { formatEther } from "viem";

type Props = {
  // The contract-rolled outcome in thousandths (e.g. 1050 = 1.05x).
  multiplierThousandths: number;
  // The bet and payout as BigInt strings for display.
  betWei: string;
  payoutWei: string;
  // How many chests the bird actually collected this run.
  chestsCollected: number;
  // Chain-explorer URL for the reveal tx (optional).
  txReveal?: string;
  explorerBase?: string;
  // Called once the player dismisses the final card.
  onContinue: () => void;
};

// Dopamine-tuned split: N-1 small-ish pieces first, last piece carries
// the remainder (usually the biggest). For bust, all zeros.
// totalTh is in thousandths. RNG is JS-local since these are purely
// cosmetic — total always equals the contract value.
function splitMultiplier(totalTh: number, count: number): number[] {
  if (count <= 0) return [];
  if (totalTh <= 0) return new Array(count).fill(0);
  if (count === 1) return [totalTh];
  const out: number[] = [];
  let remaining = totalTh;
  for (let i = 0; i < count - 1; i++) {
    // Each early piece takes 5-30% of the remaining pot so nothing is
    // zero (unless the total really is zero), but the tail still has
    // most of the weight.
    const fracTake = 0.05 + Math.random() * 0.25;
    const piece = Math.max(0, Math.min(Math.floor(remaining * fracTake), remaining - (count - 1 - i)));
    out.push(piece);
    remaining -= piece;
  }
  out.push(Math.max(0, remaining));
  return out;
}

const STEP_MS = 520; // time between chest openings
const FINAL_HOLD_MS = 900;

export function ChestReveal({
  multiplierThousandths,
  betWei,
  payoutWei,
  chestsCollected,
  txReveal,
  explorerBase,
  onContinue,
}: Props) {
  // Always at least one chest in the reveal — even if the bird didn't
  // collect anything during the run. It just opens to bust.
  const chestCount = Math.max(1, Math.min(8, chestsCollected));
  const [pieces] = useState(() => splitMultiplier(multiplierThousandths, chestCount));
  const [openIdx, setOpenIdx] = useState(-1);
  const [showFinal, setShowFinal] = useState(false);

  // Advance the reveal: open one chest per STEP_MS, then final card.
  useEffect(() => {
    if (openIdx + 1 >= pieces.length) {
      const t = setTimeout(() => setShowFinal(true), FINAL_HOLD_MS);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setOpenIdx(i => i + 1), STEP_MS);
    return () => clearTimeout(t);
  }, [openIdx, pieces.length]);

  // Running sum of revealed pieces — what the player sees adding up.
  const revealedSum = pieces.slice(0, openIdx + 1).reduce((a, b) => a + b, 0);
  const betEth = Number(formatEther(BigInt(betWei)));
  const payoutEth = Number(formatEther(BigInt(payoutWei)));
  const revealedPayout = betEth * (revealedSum / 1000);

  const isBust = multiplierThousandths === 0;
  const isJackpot = multiplierThousandths >= 5000;
  const won = BigInt(payoutWei) > BigInt(betWei);

  return (
    <div style={{
      position: "absolute", inset: 0,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      background: "rgba(2, 10, 24, 0.75)", backdropFilter: "blur(4px)",
      zIndex: 20,
      animation: "chest-reveal-in 260ms ease-out both",
      padding: 20,
    }}>
      <div style={{
        fontSize: 11, letterSpacing: "0.24em", color: "#7fe3ff",
        textTransform: "uppercase", marginBottom: 8, fontFamily: 'system-ui, sans-serif',
      }}>
        your haul
      </div>

      {/* Running payout ticker */}
      <div style={{
        fontFamily: "ui-monospace, monospace",
        fontSize: 30, fontWeight: 900,
        color: showFinal
          ? (won ? "#7fe3ff" : isBust ? "#ff8b8b" : "#ffb464")
          : "#ffd76a",
        textShadow: showFinal
          ? (won ? "0 0 22px rgba(127,227,255,0.55)" : "")
          : "0 0 18px rgba(255,215,106,0.45)",
        marginBottom: 14,
        transition: "color 220ms ease, text-shadow 220ms ease",
      }}>
        {revealedPayout.toFixed(6)} ETH
      </div>

      {/* Chest row */}
      <div style={{
        display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center",
        maxWidth: 520, marginBottom: 16,
      }}>
        {pieces.map((piece, i) => {
          const state = i <= openIdx ? "open" : "closed";
          const multi = piece / 1000;
          return (
            <div
              key={i}
              style={{
                width: 72, height: 82,
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                gap: 4,
                borderRadius: 12,
                background: state === "open"
                  ? (piece === 0
                      ? "rgba(255, 116, 116, 0.14)"
                      : piece >= 1800
                      ? "linear-gradient(180deg, #ffe17a, #c8940a)"
                      : piece >= 1200
                      ? "linear-gradient(180deg, #ffd76a, #b8790f)"
                      : "linear-gradient(180deg, #6aa8ff, #254d80)")
                  : "linear-gradient(180deg, #3a2416, #1a0f08)",
                border: state === "open"
                  ? (piece === 0 ? "1px solid rgba(255,116,116,0.4)" : "1px solid rgba(255,255,255,0.25)")
                  : "1px solid rgba(110, 70, 40, 0.8)",
                boxShadow: state === "open" && piece > 0
                  ? "0 8px 24px rgba(255, 215, 106, 0.3)"
                  : "0 4px 14px rgba(0,0,0,0.4)",
                transform: state === "open" ? "scale(1.08) translateY(-4px)" : "scale(1)",
                transition: "all 320ms cubic-bezier(0.2, 1.2, 0.4, 1)",
                fontFamily: 'system-ui, sans-serif',
                color: state === "open" ? (piece === 0 ? "#ff8b8b" : "#0a1428") : "#c0a078",
              }}
            >
              {state === "closed" ? (
                <>
                  <svg width="26" height="20" viewBox="0 0 26 20" fill="none">
                    <rect x="2" y="6" width="22" height="12" rx="2" fill="#8b5a2b" />
                    <rect x="2" y="6" width="22" height="3" rx="1.5" fill="#6a4220" />
                    <path d="M6 6 Q 13 -2 20 6" stroke="#5a3410" strokeWidth="2" fill="none" />
                    <rect x="11" y="9" width="4" height="5" rx="1" fill="#ffd76a" />
                  </svg>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>?</div>
                </>
              ) : piece === 0 ? (
                <>
                  <div style={{ fontSize: 20 }}>✖</div>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em" }}>BUST</div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 11, opacity: 0.85, fontWeight: 700 }}>+</div>
                  <div style={{ fontSize: 16, fontWeight: 900 }}>{multi.toFixed(2)}×</div>
                  <div style={{ fontSize: 9, opacity: 0.75 }}>
                    {(betEth * multi).toFixed(5)}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Final payout card — drops in after the last chest opens */}
      {showFinal && (
        <div style={{
          padding: "14px 22px",
          background: "rgba(2, 24, 48, 0.88)",
          border: `1px solid ${won ? "rgba(127,227,255,0.5)" : isBust ? "rgba(255,116,116,0.5)" : "rgba(255,215,106,0.5)"}`,
          borderRadius: 14, color: "#cfe7ff",
          textAlign: "center", minWidth: 260,
          animation: "chest-final-in 340ms cubic-bezier(0.2, 1.3, 0.35, 1) both",
          boxShadow: won
            ? "0 14px 50px rgba(127,227,255,0.35)"
            : "0 14px 50px rgba(0,0,0,0.5)",
        }}>
          <div style={{ fontSize: 11, opacity: 0.75, fontFamily: 'system-ui, sans-serif', letterSpacing: "0.14em", textTransform: "uppercase" }}>
            {isBust ? "BUST" : isJackpot ? "JACKPOT" : won ? "WIN" : "partial"}
            {!isBust && <> · {(multiplierThousandths / 1000).toFixed(2)}×</>}
          </div>
          <div style={{
            fontFamily: "ui-monospace, monospace",
            fontSize: 24, fontWeight: 900, marginTop: 2,
            color: won ? "#7fe3ff" : isBust ? "#ff8b8b" : "#ffb464",
          }}>
            {payoutEth.toFixed(6)} ETH
          </div>
          <div style={{ fontSize: 10, opacity: 0.6, marginTop: 2, fontFamily: 'system-ui, sans-serif' }}>
            bet {betEth.toFixed(5)} ETH · {chestCount} chest{chestCount === 1 ? "" : "s"} opened
          </div>
          {txReveal && explorerBase && (
            <a href={`${explorerBase}/tx/${txReveal}`} target="_blank" rel="noopener noreferrer"
               style={{ fontSize: 10, color: "#7fe3ff", display: "block", marginTop: 4, opacity: 0.8 }}>
              reveal tx ↗
            </a>
          )}
          <button
            onClick={onContinue}
            style={{
              marginTop: 10,
              background: won ? "#7fe3ff" : "#ffd76a",
              color: "#021830",
              border: "none",
              borderRadius: 8,
              padding: "8px 20px",
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: "0.1em",
              cursor: "pointer",
            }}
          >
            CONTINUE
          </button>
        </div>
      )}
    </div>
  );
}

"use client";

// Side-by-side sign-off page for two game-design directions we're
// weighing for the squid chest game:
//   - "cannon" — Moonsheep-style angle-and-fire with a landing strip
//     of multiplier zones (full distribution, you watch it land)
//   - "target" — pick your target multiplier before launch; seed
//     either clears the bar or busts (one input, one result)

import { useEffect, useState } from "react";
import { CannonGame } from "@/components/CannonGame";
import { TargetPickPreview } from "@/components/TargetPickPreview";

export const dynamic = "force-dynamic";

type Mode = "target" | "cannon";

export default function PreviewPage() {
  const [mode, setMode] = useState<Mode>("target");

  // Let ?mode=cannon preselect the cannon tab — useful for sharing a
  // direct link to either design.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search).get("mode");
    if (q === "cannon" || q === "target") setMode(q);
  }, []);

  return (
    <main style={{
      minHeight: "100vh",
      background: "linear-gradient(180deg, #02122a 0%, #050a1f 100%)",
      color: "#cfe7ff",
      padding: "24px 20px 48px",
      fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    }}>
      <div style={{ maxWidth: 1300, margin: "0 auto", display: "flex", flexDirection: "column", gap: 18 }}>
        <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: "0.22em", color: "#7fe3ff", textTransform: "uppercase" }}>
              ink squid · design preview
            </div>
            <h1 style={{ margin: "4px 0 0", fontSize: "clamp(1.4rem, 3vw, 2rem)", color: "#fff" }}>
              pick-your-target vs. cannon launcher
            </h1>
          </div>
          <nav style={{ display: "flex", gap: 6, background: "rgba(2,24,48,0.6)", padding: 4, borderRadius: 10, border: "1px solid rgba(127,227,255,0.2)" }}>
            {(["target", "cannon"] as Mode[]).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                style={{
                  padding: "8px 16px",
                  background: mode === m ? "linear-gradient(180deg,#ffd76a 0%,#e0a020 100%)" : "transparent",
                  color: mode === m ? "#1a0a00" : "#cfe7ff",
                  border: "none",
                  borderRadius: 7,
                  fontWeight: 700,
                  fontSize: 12,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {m === "target" ? "target pick" : "cannon"}
              </button>
            ))}
          </nav>
        </header>

        <div style={{
          background: "rgba(2,24,48,0.4)",
          border: "1px solid rgba(127,227,255,0.18)",
          borderRadius: 16,
          padding: 18,
        }}>
          {mode === "target" ? <TargetPickPreview /> : <CannonGame />}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
          <div style={blurbCss}>
            <h3 style={blurbTitleCss}>target pick</h3>
            <p style={blurbBodyCss}>
              Player picks a target multiplier from the ladder. Seed rolls
              a number; if it clears the threshold, you win at your
              target (not the roll). One input, one outcome — same agency
              shape as Stake Dice but in squid clothing.
            </p>
            <div style={proCssList}>
              <div>+ strongest player agency</div>
              <div>+ clean "did I hit or miss" result</div>
              <div>+ hit % visible before fire</div>
              <div>− no distribution drama</div>
            </div>
          </div>
          <div style={blurbCss}>
            <h3 style={blurbTitleCss}>cannon launcher</h3>
            <p style={blurbBodyCss}>
              Player sets angle + power, cannon fires the squid along an
              arc, lands on one of 7 multiplier zones from the contract
              curve. Full distribution — lots of "oh it almost landed
              on 5×" near-miss energy.
            </p>
            <div style={proCssList}>
              <div>+ cinematic "watch it land" moment</div>
              <div>+ near-miss drama for free</div>
              <div>+ fits the moonsheep launcher metaphor</div>
              <div>− decision feels less sharp</div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

const blurbCss: React.CSSProperties = {
  background: "rgba(2,24,48,0.55)",
  border: "1px solid rgba(127,227,255,0.2)",
  borderRadius: 12,
  padding: 16,
};
const blurbTitleCss: React.CSSProperties = {
  margin: 0,
  fontSize: 13,
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  color: "#7fe3ff",
};
const blurbBodyCss: React.CSSProperties = {
  fontSize: 13,
  lineHeight: 1.55,
  color: "#cfe7ff",
  margin: "8px 0 10px",
};
const proCssList: React.CSSProperties = {
  fontSize: 12,
  lineHeight: 1.7,
  color: "#9ebfd6",
  fontFamily: "ui-monospace, monospace",
};

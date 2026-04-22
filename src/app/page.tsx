import { ChestsGame } from "@/components/ChestsGame";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Ink Squid",
  description: "Pick your bet up to 0.01 ETH, the squid auto-plays, 92.8% RTP with commit-reveal fairness.",
};

export default function Home() {
  return (
    <div style={{
      minHeight: "100vh",
      background: "radial-gradient(ellipse 90% 60% at 50% 10%, #0a2540 0%, #031026 55%, #01060f 100%)",
      color: "#cfe7ff",
      fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      padding: "28px 16px 40px",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 18,
    }}>
      {/* Brand header with a squid glyph and balanced spacing */}
      <header style={{ textAlign: "center", maxWidth: 560 }}>
        <div style={{ fontSize: 10, letterSpacing: "0.32em", color: "#7fe3ff", textTransform: "uppercase", marginBottom: 6 }}>
          on ink · commit-reveal fair
        </div>
        <h1 style={{
          margin: 0,
          fontSize: "clamp(2rem, 5vw, 2.8rem)",
          fontWeight: 900,
          letterSpacing: "-0.02em",
          color: "#fff",
          textShadow: "0 0 24px rgba(127,227,255,0.35)",
        }}>
          🦑 Ink Squid
        </h1>
        <p style={{ margin: "10px 0 0", fontSize: 13, color: "#a6c1db", lineHeight: 1.55 }}>
          Pick a bet up to 0.01 ETH. The squid auto-flies while the contract rolls a single outcome
          from your committed seed. <b style={{ color: "#fff" }}>92.8% RTP</b>, 8% house edge —
          tight band around break-even with a 5× jackpot tail.
        </p>
      </header>

      {/* Game links — side navigation to the cannon sibling */}
      <nav style={{ display: "flex", gap: 8 }}>
        <span style={{
          background: "rgba(127,227,255,0.14)",
          border: "1px solid rgba(127,227,255,0.4)",
          color: "#7fe3ff",
          padding: "6px 14px",
          borderRadius: 999,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
        }}>
          Chests
        </span>
        <a href="/preview" style={{
          background: "rgba(255,215,106,0.08)",
          border: "1px solid rgba(255,215,106,0.35)",
          color: "#ffd76a",
          padding: "6px 14px",
          borderRadius: 999,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          textDecoration: "none",
        }}>
          Squid Cannon ↗
        </a>
      </nav>

      <ChestsGame />
    </div>
  );
}

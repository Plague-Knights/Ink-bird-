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
      background: "#020716",
      color: "#cfe7ff",
      padding: "24px 16px",
      fontFamily: "system-ui, sans-serif",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 14,
    }}>
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: "0.02em" }}>
        Ink Squid
      </h1>
      <p style={{ margin: 0, fontSize: 12, color: "#7b94b8", textAlign: "center", maxWidth: 540, lineHeight: 1.5 }}>
        Pick any bet up to 0.01 ETH. The squid auto-plays and the contract rolls a single multiplier
        from your committed seed on-chain. <b style={{ color: "#cfe7ff" }}>92.8% RTP</b> dialed in,
        8% house edge — tight band around break-even with a 5× jackpot tail. Fully provably fair via
        commit-reveal.
      </p>
      <ChestsGame />
    </div>
  );
}

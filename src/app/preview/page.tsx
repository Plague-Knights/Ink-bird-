"use client";

// Playable cannon game at /preview. The old "target pick vs. cannon"
// tab switcher is gone — we committed to the cannon mechanic.

import { CannonGame } from "@/components/CannonGame";

export const dynamic = "force-dynamic";

export default function PreviewPage() {
  return (
    <main style={{
      minHeight: "100vh",
      background: "linear-gradient(180deg, #02122a 0%, #050a1f 100%)",
      color: "#cfe7ff",
      padding: "14px 10px 40px",
      fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    }}>
      <div style={{ maxWidth: 1300, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
        <header>
          <div style={{ fontSize: 10, letterSpacing: "0.22em", color: "#7fe3ff", textTransform: "uppercase" }}>
            ink squid
          </div>
          <h1 style={{ margin: "4px 0 0", fontSize: "clamp(1.4rem, 3vw, 2rem)", color: "#fff" }}>
            squid cannon
          </h1>
        </header>

        <div style={{
          background: "rgba(2,24,48,0.4)",
          border: "1px solid rgba(127,227,255,0.18)",
          borderRadius: 14,
          padding: 10,
        }}>
          <CannonGame />
        </div>
      </div>
    </main>
  );
}

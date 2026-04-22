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
      padding: "6px 6px 14px",
      fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    }}>
      <div style={{ maxWidth: 1800, margin: "0 auto", display: "flex", flexDirection: "column", gap: 6 }}>
        <CannonGame />
      </div>
    </main>
  );
}

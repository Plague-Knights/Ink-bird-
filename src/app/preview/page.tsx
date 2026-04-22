"use client";

// Playable cannon game at /preview. The old "target pick vs. cannon"
// tab switcher is gone — we committed to the cannon mechanic.

import { CannonGame } from "@/components/CannonGame";

export const dynamic = "force-dynamic";

export default function PreviewPage() {
  return (
    <main style={{ background: "#02122a", color: "#cfe7ff" }}>
      <CannonGame />
    </main>
  );
}

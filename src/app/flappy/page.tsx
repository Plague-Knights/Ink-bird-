"use client";

import { useCallback, useState } from "react";
import { Game } from "@/components/Game";
import { Leaderboard } from "@/components/Leaderboard";
import { ConnectWallet } from "@/components/ConnectWallet";
import { AttemptsPanel } from "@/components/AttemptsPanel";
import { ReferralPanel } from "@/components/ReferralPanel";
import { ClaimPanel } from "@/components/ClaimPanel";
import { useAttempts, useAuth } from "@/lib/useSession";

export default function FlappyPage() {
  const { signedIn } = useAuth();
  const { remaining, refresh: refreshAttempts } = useAttempts();
  const [refreshKey, setRefreshKey] = useState(0);

  const onBeforeStart = useCallback(async () => {
    if (!signedIn) return null;
    try {
      const res = await fetch("/api/attempts/start", { method: "POST" });
      if (!res.ok) return null;
      const data = await res.json();
      refreshAttempts();
      return { attemptId: data.attemptId as string, seed: data.seed as number };
    } catch {
      return null;
    }
  }, [signedIn, refreshAttempts]);

  const onGameOver = useCallback(async (result: {
    attemptId: string;
    seed: number;
    inputs: { f: number; t: "flap" }[];
    claimedScore: number;
  }) => {
    try {
      await fetch("/api/replay/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          attemptId: result.attemptId,
          inputs: result.inputs,
          claimedScore: result.claimedScore,
        }),
      });
      setRefreshKey((k) => k + 1);
    } catch {}
  }, []);

  const canStart = signedIn && remaining > 0;

  return (
    <div className="wrap">
      <div className="topbar">
        <h1>Ink Squid</h1>
        <ConnectWallet />
      </div>
      <div className="stage">
        <div className="game-col">
          <Game canStart={canStart} onBeforeStart={onBeforeStart} onGameOver={onGameOver} />
          <AttemptsPanel />
          <ClaimPanel signedIn={signedIn} />
          <ReferralPanel />
        </div>
        <Leaderboard refreshKey={refreshKey} />
      </div>
    </div>
  );
}

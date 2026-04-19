"use client";

import { useCallback, useEffect, useState } from "react";
import { Game } from "@/components/Game";
import { Leaderboard } from "@/components/Leaderboard";
import { ConnectWallet } from "@/components/ConnectWallet";
import { AttemptsPanel } from "@/components/AttemptsPanel";
import { ClaimPanel } from "@/components/ClaimPanel";

export default function Home() {
  const [signedIn, setSignedIn] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);

  const refreshAuth = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      const data = await res.json();
      setSignedIn(Boolean(data.address));
    } catch {
      setSignedIn(false);
    }
  }, []);

  const refreshAttempts = useCallback(async () => {
    if (!signedIn) { setRemaining(0); return; }
    try {
      const res = await fetch("/api/attempts/me", { cache: "no-store" });
      const data = await res.json();
      setRemaining(typeof data.remaining === "number" ? data.remaining : 0);
    } catch {
      setRemaining(0);
    }
  }, [signedIn]);

  useEffect(() => { refreshAuth(); }, [refreshAuth]);
  useEffect(() => { refreshAttempts(); }, [refreshAttempts]);
  useEffect(() => {
    const onFocus = () => { refreshAuth(); refreshAttempts(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshAuth, refreshAttempts]);

  const onBeforeStart = useCallback(async () => {
    if (!signedIn) return null;
    try {
      const res = await fetch("/api/attempts/start", { method: "POST" });
      if (!res.ok) return null;
      const data = await res.json();
      await refreshAttempts();
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
          <AttemptsPanel signedIn={signedIn} onChange={refreshAttempts} />
          <ClaimPanel signedIn={signedIn} />
        </div>
        <Leaderboard refreshKey={refreshKey} />
      </div>
    </div>
  );
}

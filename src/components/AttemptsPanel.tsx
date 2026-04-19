"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { formatEther, parseEther } from "viem";
import { activeContracts } from "@/lib/chain";
import { InkSquidArcadeAbi } from "@/config/abis/InkSquidArcade";

export function AttemptsPanel({
  signedIn,
  onChange,
}: {
  signedIn: boolean;
  onChange?: () => void;
}) {
  const { address } = useAccount();
  const [remaining, setRemaining] = useState<number | null>(null);
  const [packs, setPacks] = useState(1);

  const { writeContract, isPending, data: txHash } = useWriteContract();
  const { data: pool } = useReadContract({
    address: activeContracts.arcade,
    abi: InkSquidArcadeAbi,
    functionName: "weeks_",
    args: [0n],
    query: { refetchInterval: 20_000 },
  });

  const refresh = useCallback(async () => {
    if (!signedIn) { setRemaining(null); return; }
    try {
      const res = await fetch("/api/attempts/me", { cache: "no-store" });
      const data = await res.json();
      setRemaining(typeof data.remaining === "number" ? data.remaining : 0);
      onChange?.();
    } catch {
      setRemaining(0);
    }
  }, [signedIn, onChange]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (!txHash) return;
    const t = window.setTimeout(refresh, 5000);
    return () => window.clearTimeout(t);
  }, [txHash, refresh]);

  const buy = useCallback(() => {
    const value = parseEther("0.01") * BigInt(packs);
    writeContract({
      address: activeContracts.arcade,
      abi: InkSquidArcadeAbi,
      functionName: "buyAttempts",
      value,
    });
  }, [packs, writeContract]);

  const poolEth = pool ? formatEther((pool as readonly bigint[])[0]) : "0";

  return (
    <div className="panel">
      <div className="panel-row">
        <div className="stat">
          <span>Attempts</span>
          <b>{remaining ?? (signedIn ? "…" : "—")}</b>
        </div>
        <div className="stat">
          <span>Week pool</span>
          <b>{Number(poolEth).toFixed(3)} ETH</b>
        </div>
      </div>
      {address && (
        <div className="panel-row buy-row">
          <div className="packs">
            <button
              className="icon-btn"
              onClick={() => setPacks((p) => Math.max(1, p - 1))}
              type="button"
            >
              −
            </button>
            <span>{packs} × 100</span>
            <button
              className="icon-btn"
              onClick={() => setPacks((p) => p + 1)}
              type="button"
            >
              +
            </button>
          </div>
          <button
            className="big-btn"
            onClick={buy}
            disabled={isPending}
            type="button"
          >
            {isPending ? "SENDING…" : `BUY ${(0.01 * packs).toFixed(2)} ETH`}
          </button>
        </div>
      )}
    </div>
  );
}

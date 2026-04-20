"use client";

import { useCallback, useEffect } from "react";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { formatEther, parseEther } from "viem";
import { useState } from "react";
import { activeContracts } from "@/lib/chain";
import { InkSquidArcadeAbi } from "@/config/abis/InkSquidArcade";
import { useAttempts, useAuth } from "@/lib/useSession";
import { BPS_DENOM, PLAYER_SHARE_BPS } from "@/lib/payouts";

export function AttemptsPanel() {
  const { address } = useAccount();
  const { signedIn } = useAuth();
  const { remaining, loaded, refresh: refreshAttempts } = useAttempts();
  const [packs, setPacks] = useState(1);

  const { writeContract, isPending, data: txHash } = useWriteContract();
  const { data: pool } = useReadContract({
    address: activeContracts.arcade,
    abi: InkSquidArcadeAbi,
    functionName: "weeks_",
    args: [0n],
    query: { refetchInterval: 20_000 },
  });

  // After a buy tx is sent, the on-chain balance takes a block or two to
  // settle. One delayed re-pull covers the common case.
  useEffect(() => {
    if (!txHash) return;
    const t = window.setTimeout(refreshAttempts, 5000);
    return () => window.clearTimeout(t);
  }, [txHash, refreshAttempts]);

  const buy = useCallback(() => {
    const value = parseEther("0.01") * BigInt(packs);
    writeContract({
      address: activeContracts.arcade,
      abi: InkSquidArcadeAbi,
      functionName: "buyAttempts",
      value,
    });
  }, [packs, writeContract]);

  const poolWei = pool ? (pool as readonly bigint[])[0] : 0n;
  const playerPoolWei = (poolWei * BigInt(PLAYER_SHARE_BPS)) / BigInt(BPS_DENOM);
  const poolEth = formatEther(playerPoolWei);

  const remainingText = !signedIn
    ? "—"
    : !loaded
      ? "…"
      : String(remaining);

  return (
    <div className="panel">
      <div className="panel-row">
        <div className="stat">
          <span>Attempts</span>
          <b>{remainingText}</b>
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

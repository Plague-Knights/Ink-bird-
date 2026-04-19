"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { formatEther } from "viem";
import { activeContracts } from "@/lib/chain";
import { InkSquidArcadeAbi } from "@/config/abis/InkSquidArcade";

type Proof = {
  weekId: number;
  address: string;
  amount: string;
  proof: `0x${string}`[];
};

export function ClaimPanel({ signedIn }: { signedIn: boolean }) {
  const { address } = useAccount();
  const [weekInput, setWeekInput] = useState("");
  const [proof, setProof] = useState<Proof | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const { writeContract, isPending, data: txHash } = useWriteContract();

  const { data: claimedFlag } = useReadContract({
    address: activeContracts.arcade,
    abi: InkSquidArcadeAbi,
    functionName: "claimedByWeek",
    args: proof && address ? [BigInt(proof.weekId), address] : undefined,
    query: { enabled: Boolean(proof && address) },
  });

  const fetchProof = useCallback(async () => {
    if (!address) return;
    const weekId = Number(weekInput);
    if (!Number.isInteger(weekId) || weekId < 0) {
      setError("Enter a week number");
      return;
    }
    setLoading(true);
    setError(null);
    setProof(null);
    try {
      const res = await fetch(
        `/api/claim-proof?week=${weekId}&address=${address.toLowerCase()}`,
        { cache: "no-store" },
      );
      if (res.status === 404) {
        setError("No prize for this address in that week.");
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Fetch failed");
      }
      const data = await res.json();
      setProof({
        weekId: data.weekId,
        address: data.address,
        amount: data.amount,
        proof: data.proof,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fetch failed");
    } finally {
      setLoading(false);
    }
  }, [address, weekInput]);

  const doClaim = useCallback(() => {
    if (!proof) return;
    writeContract({
      address: activeContracts.arcade,
      abi: InkSquidArcadeAbi,
      functionName: "claim",
      args: [BigInt(proof.weekId), BigInt(proof.amount), proof.proof],
    });
  }, [proof, writeContract]);

  if (!signedIn || !address) return null;

  return (
    <div className="panel">
      <h3 className="panel-title">Claim a past-week prize</h3>
      <div className="panel-row">
        <input
          className="week-input"
          placeholder="Week #"
          value={weekInput}
          onChange={(e) => setWeekInput(e.target.value.replace(/[^0-9]/g, ""))}
        />
        <button className="icon-btn" onClick={fetchProof} disabled={loading} type="button">
          {loading ? "…" : "LOOK UP"}
        </button>
      </div>
      {error && <p className="hint" style={{ color: "#ff8a8a" }}>{error}</p>}
      {proof && (
        <div className="claim-info">
          <div>Week {proof.weekId}: <b>{Number(formatEther(BigInt(proof.amount))).toFixed(4)} ETH</b></div>
          {claimedFlag ? (
            <p className="hint">Already claimed.</p>
          ) : (
            <button
              className="big-btn"
              onClick={doClaim}
              disabled={isPending}
              type="button"
            >
              {isPending ? "CLAIMING…" : "CLAIM"}
            </button>
          )}
          {txHash && <p className="hint">Tx: {txHash.slice(0, 10)}…</p>}
        </div>
      )}
    </div>
  );
}

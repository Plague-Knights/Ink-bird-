"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useCallback, useState } from "react";
import { useAccount, useChainId, useSignMessage, useSwitchChain } from "wagmi";
import { activeChain } from "@/config/wagmi";
import { useAuth } from "@/lib/useSession";

export function ConnectWallet() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { signMessageAsync } = useSignMessage();
  const { switchChain, isPending: switching } = useSwitchChain();
  const { signedIn, refresh: refreshSession } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onWrongChain = isConnected && chainId !== activeChain.id;

  // Triggers wallet_switchEthereumChain. If the chain isn't in the wallet,
  // wagmi falls back to wallet_addEthereumChain automatically.
  const addOrSwitchChain = useCallback(() => {
    switchChain({ chainId: activeChain.id });
  }, [switchChain]);

  const signIn = useCallback(async () => {
    if (!address) return;
    setBusy(true);
    setError(null);
    try {
      const nonceRes = await fetch("/api/auth/nonce", { method: "POST" });
      const { nonce } = await nonceRes.json();

      const domain = window.location.host;
      const uri = window.location.origin;
      const issuedAt = new Date().toISOString();
      const message = [
        `${domain} wants you to sign in with your Ethereum account:`,
        address,
        "",
        "Sign in to submit your Ink Squid score.",
        "",
        `URI: ${uri}`,
        `Version: 1`,
        `Chain ID: ${chainId}`,
        `Nonce: ${nonce}`,
        `Issued At: ${issuedAt}`,
      ].join("\n");

      const signature = await signMessageAsync({ message });

      const verifyRes = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, signature }),
      });
      if (!verifyRes.ok) {
        const body = await verifyRes.json().catch(() => ({}));
        throw new Error(body.error ?? "Signature verification failed");
      }
      await refreshSession();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }, [address, chainId, signMessageAsync, refreshSession]);

  const signOut = useCallback(async () => {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      await refreshSession();
    } finally {
      setBusy(false);
    }
  }, [refreshSession]);

  return (
    <div className="wallet">
      <ConnectButton chainStatus="icon" showBalance={false} />
      {onWrongChain && (
        <button
          className="icon-btn wrong-chain-btn"
          onClick={addOrSwitchChain}
          disabled={switching}
          type="button"
          title={`Add / switch to ${activeChain.name}`}
        >
          {switching ? "Switching…" : `Add ${activeChain.name}`}
        </button>
      )}
      {isConnected && !onWrongChain && !signedIn && (
        <button className="icon-btn" onClick={signIn} disabled={busy} type="button">
          {busy ? "Signing…" : "Sign in"}
        </button>
      )}
      {signedIn && (
        <button className="icon-btn" onClick={signOut} disabled={busy} type="button">
          Sign out
        </button>
      )}
      {error && <span className="wallet-error">{error}</span>}
    </div>
  );
}

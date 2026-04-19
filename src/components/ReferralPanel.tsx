"use client";

import { useCallback, useMemo, useState } from "react";
import { useAuth } from "@/lib/useSession";
import { REFERRAL_BPS, BPS_DENOM } from "@/lib/payouts";

export function ReferralPanel() {
  const { address, signedIn } = useAuth();
  const [copied, setCopied] = useState(false);

  const link = useMemo(() => {
    if (!address || typeof window === "undefined") return "";
    return `${window.location.origin}/?ref=${address}`;
  }, [address]);

  const copy = useCallback(async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked in iframes / insecure contexts — user can
      // still select the text manually.
    }
  }, [link]);

  if (!signedIn) return null;

  const pct = ((REFERRAL_BPS / BPS_DENOM) * 100).toFixed(0);

  return (
    <div className="panel">
      <h3 className="panel-title">Referral link — earn {pct}%</h3>
      <div className="ref-row">
        <code className="ref-link" title={link}>{link}</code>
        <button className="icon-btn" onClick={copy} type="button">
          {copied ? "COPIED" : "COPY"}
        </button>
      </div>
    </div>
  );
}

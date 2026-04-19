"use client";

import { useEffect } from "react";
import { isAddress } from "viem";

// Pulls `?ref=0x…` out of the URL once on mount, POSTs it to the server
// (pins it to the iron-session cookie), then strips the param from the
// visible URL so reloading won't re-submit or leak the referrer.
export function ReferralCapture() {
  useEffect(() => {
    const url = new URL(window.location.href);
    const ref = url.searchParams.get("ref");
    if (!ref || !isAddress(ref)) return;

    fetch("/api/referral/capture", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ referrer: ref }),
    }).catch(() => {
      // Best-effort. A failed capture just means no credit; don't surface.
    });

    url.searchParams.delete("ref");
    const cleaned = url.pathname + (url.searchParams.toString() ? `?${url.searchParams}` : "") + url.hash;
    window.history.replaceState(null, "", cleaned);
  }, []);

  return null;
}

"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

// Shared client-side cache for /api/auth/me + /api/attempts/me. Both hooks
// subscribe to the same in-memory store, so mounting two components that
// read either piece of state doesn't fire duplicate network requests.
//
// No SWR dep — a tiny event-emitter + promise-sharing does the same work
// for two endpoints. If we add more, switch to SWR or react-query.

type AuthState = { address: string | null; loaded: boolean };
type AttemptsState = { remaining: number; loaded: boolean };

const listeners = new Set<() => void>();
let authState: AuthState = { address: null, loaded: false };
let attemptsState: AttemptsState = { remaining: 0, loaded: false };

let authInFlight: Promise<void> | null = null;
let attemptsInFlight: Promise<void> | null = null;

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function loadAuth() {
  if (authInFlight) return authInFlight;
  authInFlight = (async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      const data = await res.json();
      authState = { address: typeof data.address === "string" ? data.address : null, loaded: true };
    } catch {
      authState = { address: null, loaded: true };
    } finally {
      authInFlight = null;
      emit();
    }
  })();
  return authInFlight;
}

async function loadAttempts() {
  // No point asking if the user isn't signed in.
  if (!authState.address) {
    attemptsState = { remaining: 0, loaded: true };
    emit();
    return;
  }
  if (attemptsInFlight) return attemptsInFlight;
  attemptsInFlight = (async () => {
    try {
      const res = await fetch("/api/attempts/me", { cache: "no-store" });
      const data = await res.json();
      attemptsState = {
        remaining: typeof data.remaining === "number" ? data.remaining : 0,
        loaded: true,
      };
    } catch {
      attemptsState = { remaining: 0, loaded: true };
    } finally {
      attemptsInFlight = null;
      emit();
    }
  })();
  return attemptsInFlight;
}

// useSyncExternalStore guarantees React's concurrent-mode-safe subscribe
// without tearing. Consumers never cause duplicate fetches because the
// store itself dedupes via the in-flight promise.
export function useAuth() {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => authState,
    () => ({ address: null, loaded: false } as AuthState),
  );

  useEffect(() => {
    if (!snapshot.loaded && !authInFlight) loadAuth();
  }, [snapshot.loaded]);

  const refresh = useCallback(() => loadAuth(), []);
  return {
    address: snapshot.address,
    signedIn: Boolean(snapshot.address),
    loaded: snapshot.loaded,
    refresh,
  };
}

export function useAttempts() {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => attemptsState,
    () => ({ remaining: 0, loaded: false } as AttemptsState),
  );

  useEffect(() => {
    if (authState.loaded && !snapshot.loaded && !attemptsInFlight) loadAttempts();
  }, [snapshot.loaded]);

  const refresh = useCallback(() => loadAttempts(), []);
  return { remaining: snapshot.remaining, loaded: snapshot.loaded, refresh };
}

// When auth flips (sign in / out) attempts state becomes stale. One global
// listener re-pulls once, shared across all consumers.
let authChangeBound = false;
function bindAuthChangeHook() {
  if (authChangeBound) return;
  authChangeBound = true;
  let lastAddress = authState.address;
  listeners.add(() => {
    if (authState.address !== lastAddress) {
      lastAddress = authState.address;
      attemptsState = { remaining: 0, loaded: false };
      loadAttempts();
    }
  });
}

if (typeof window !== "undefined") {
  bindAuthChangeHook();
  window.addEventListener("focus", () => {
    loadAuth().then(() => loadAttempts());
  });
}

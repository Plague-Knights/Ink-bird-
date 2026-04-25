// In-memory store for the server seed pre-image of each in-flight
// InkSquidGame round. Same shape and caveats as chestRounds.ts — seed
// only needs to survive between /api/game/open and the matching
// reveal call on the same process within seconds. If the process
// restarts the player's bet is still refundable via the on-chain
// claimTimeout path after 1h, so seed loss is no longer a fund-lock
// (it's "just" a player-forced wait + 1x refund instead of a real
// outcome). Upgrade path: Prisma-backed table keyed on seedHash
// (security_gaps.md item 1).

const TTL_MS = 30 * 60 * 1000; // 30 minutes

export type Entry = {
  serverSeed: `0x${string}`;
  chainId: number;
  createdAt: number;
};

const store = new Map<string, Entry>();

function cleanup() {
  const cutoff = Date.now() - TTL_MS;
  for (const [k, v] of store) {
    if (v.createdAt < cutoff) store.delete(k);
  }
}

export function rememberServerSeed(seedHash: string, serverSeed: `0x${string}`, chainId: number) {
  cleanup();
  store.set(seedHash.toLowerCase(), { serverSeed, chainId, createdAt: Date.now() });
}

export function recallServerSeed(seedHash: string): Entry | null {
  const e = store.get(seedHash.toLowerCase());
  if (!e) return null;
  if (Date.now() - e.createdAt > TTL_MS) {
    store.delete(seedHash.toLowerCase());
    return null;
  }
  return e;
}

export function forgetServerSeed(seedHash: string) {
  store.delete(seedHash.toLowerCase());
}

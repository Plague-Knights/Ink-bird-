// In-memory store for the seed pre-image of each in-flight chest round.
//
// This is intentionally NOT in Postgres for v1: the seed only needs to
// survive between /api/chest/open and the matching reveal call, both
// of which happen on the same server instance within seconds. If the
// process restarts mid-round the player's tx still settles on-chain
// (the contract just refuses to reveal without a matching seed), and
// the player can request a fresh round.
//
// When we go multi-instance the right move is Redis or a Prisma row;
// keeping the API the same here makes that swap painless.

const TTL_MS = 30 * 60 * 1000; // 30 minutes

export type Entry = {
  seed: `0x${string}`;
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

export function rememberSeed(seedHash: string, seed: `0x${string}`, chainId: number) {
  cleanup();
  store.set(seedHash.toLowerCase(), { seed, chainId, createdAt: Date.now() });
}

export function recallSeed(seedHash: string): Entry | null {
  const e = store.get(seedHash.toLowerCase());
  if (!e) return null;
  if (Date.now() - e.createdAt > TTL_MS) {
    store.delete(seedHash.toLowerCase());
    return null;
  }
  return e;
}

export function forgetSeed(seedHash: string) {
  store.delete(seedHash.toLowerCase());
}

// Pure Merkle helpers matching the on-chain contract's leaf encoding:
//   leaf = keccak256(keccak256(abi.encode(address, uint256 amount)))
// Pair hashing uses OpenZeppelin's "sorted" pattern (smaller first).

import { encodeAbiParameters, keccak256 } from "viem";

export type Row = { address: `0x${string}`; amount: bigint };
export type BuiltTree = {
  root: `0x${string}`;
  leaves: `0x${string}`[];
  proofs: `0x${string}`[][];
};

export function leafOf(row: Row): `0x${string}` {
  const inner = keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }],
      [row.address, row.amount],
    ),
  );
  return keccak256(inner);
}

function hashPair(a: `0x${string}`, b: `0x${string}`): `0x${string}` {
  const [lo, hi] = BigInt(a) < BigInt(b) ? [a, b] : [b, a];
  return keccak256(("0x" + lo.slice(2) + hi.slice(2)) as `0x${string}`);
}

export function buildTree(rows: Row[]): BuiltTree {
  if (rows.length === 0) {
    return { root: "0x0000000000000000000000000000000000000000000000000000000000000000", leaves: [], proofs: [] };
  }
  const leaves = rows.map(leafOf);
  const levels: `0x${string}`[][] = [leaves];
  while (levels[levels.length - 1].length > 1) {
    const prev = levels[levels.length - 1];
    const next: `0x${string}`[] = [];
    for (let i = 0; i < prev.length; i += 2) {
      if (i + 1 === prev.length) next.push(prev[i]);
      else next.push(hashPair(prev[i], prev[i + 1]));
    }
    levels.push(next);
  }
  const proofs: `0x${string}`[][] = leaves.map((_, index) => {
    const proof: `0x${string}`[] = [];
    let idx = index;
    for (let d = 0; d < levels.length - 1; d++) {
      const level = levels[d];
      const sibling = idx ^ 1;
      if (sibling < level.length) proof.push(level[sibling]);
      idx = Math.floor(idx / 2);
    }
    return proof;
  });
  return { root: levels[levels.length - 1][0], leaves, proofs };
}

import { keccak256, encodePacked } from "viem";

export function leafOf(player, amount) {
  return keccak256(encodePacked(["address", "uint256"], [player, BigInt(amount)]));
}

function pairHash(a, b) {
  return a < b
    ? keccak256(encodePacked(["bytes32", "bytes32"], [a, b]))
    : keccak256(encodePacked(["bytes32", "bytes32"], [b, a]));
}

export function buildTree(leaves) {
  if (!leaves.length) throw new Error("no leaves");
  let level = [...leaves];
  const tree = [level];
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i];
      const b = i + 1 < level.length ? level[i + 1] : level[i];
      next.push(pairHash(a, b));
    }
    level = next;
    tree.push(level);
  }
  return tree;
}

export function root(tree) {
  return tree[tree.length - 1][0];
}

export function proofFor(tree, index) {
  const proof = [];
  let idx = index;
  for (let lvl = 0; lvl < tree.length - 1; lvl++) {
    const level = tree[lvl];
    const sibling = idx ^ 1;
    proof.push(sibling < level.length ? level[sibling] : level[idx]);
    idx = Math.floor(idx / 2);
  }
  return proof;
}

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { keccak256, solidityPacked, parseEther, ZeroAddress } = ethers;

function leafOf(addr, amount) {
  return keccak256(solidityPacked(["address", "uint256"], [addr, amount]));
}

function pairHash(a, b) {
  return a < b
    ? keccak256(solidityPacked(["bytes32", "bytes32"], [a, b]))
    : keccak256(solidityPacked(["bytes32", "bytes32"], [b, a]));
}

// Build a sorted-pair Merkle root + proofs matching the contract's _verify.
function buildTree(leaves) {
  if (leaves.length === 0) throw new Error("no leaves");
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

function proofFor(tree, index) {
  const proof = [];
  let idx = index;
  for (let lvl = 0; lvl < tree.length - 1; lvl++) {
    const level = tree[lvl];
    const sibling = idx ^ 1;
    if (sibling < level.length) proof.push(level[sibling]);
    else proof.push(level[idx]); // duplicate last
    idx = Math.floor(idx / 2);
  }
  return proof;
}

describe("InkBirdArcade", function () {
  let arcade, owner, operator, treasury, p1, p2, p3;
  const ENTRY = parseEther("0.001");

  beforeEach(async () => {
    [owner, operator, treasury, p1, p2, p3] = await ethers.getSigners();
    const Arcade = await ethers.getContractFactory("InkBirdArcade");
    arcade = await Arcade.deploy(treasury.address, operator.address);
    await arcade.waitForDeployment();
  });

  it("rejects zero addresses in constructor", async () => {
    const Arcade = await ethers.getContractFactory("InkBirdArcade");
    await expect(Arcade.deploy(ZeroAddress, operator.address)).to.be.revertedWith("zero treasury");
    await expect(Arcade.deploy(treasury.address, ZeroAddress)).to.be.revertedWith("zero operator");
  });

  it("enter splits 90/10 and emits event", async () => {
    const tBalBefore = await ethers.provider.getBalance(treasury.address);
    await expect(arcade.connect(p1).enter({ value: ENTRY }))
      .to.emit(arcade, "EntryPurchased");
    const tBalAfter = await ethers.provider.getBalance(treasury.address);
    expect(tBalAfter - tBalBefore).to.equal(ENTRY / 10n);

    const wk = await arcade.currentWeekId();
    expect(await arcade.weekPool(wk)).to.equal((ENTRY * 9n) / 10n);
  });

  it("enter rejects wrong fee and respects pause", async () => {
    await expect(arcade.connect(p1).enter({ value: parseEther("0.01") })).to.be.revertedWith("wrong fee");
    await arcade.connect(owner).setPaused(true);
    await expect(arcade.connect(p1).enter({ value: ENTRY })).to.be.revertedWith("paused");
  });

  it("enforces per-week cap", async () => {
    await arcade.connect(owner).setPerWeekCap(parseEther("0.0009")); // 1 entry worth of pool
    await arcade.connect(p1).enter({ value: ENTRY });
    await expect(arcade.connect(p2).enter({ value: ENTRY })).to.be.revertedWith("week cap reached");
  });

  it("settles, timelocks claims, and pays winners via merkle proof", async () => {
    // 3 players fund the pool
    await arcade.connect(p1).enter({ value: ENTRY });
    await arcade.connect(p2).enter({ value: ENTRY });
    await arcade.connect(p3).enter({ value: ENTRY });

    const wk = await arcade.currentWeekId();
    const pool = await arcade.weekPool(wk);
    // Payout split: 70/20/10 of pool
    const a1 = (pool * 70n) / 100n;
    const a2 = (pool * 20n) / 100n;
    const a3 = (pool * 10n) / 100n;
    const leaves = [leafOf(p1.address, a1), leafOf(p2.address, a2), leafOf(p3.address, a3)];
    const tree = buildTree(leaves);
    const root = tree[tree.length - 1][0];
    const total = a1 + a2 + a3;

    // Fast-forward to next week
    await ethers.provider.send("evm_increaseTime", [7 * 24 * 3600 + 1]);
    await ethers.provider.send("evm_mine", []);

    await expect(arcade.connect(operator).settleWeek(wk, root, total)).to.emit(arcade, "WeekSettled");

    // Claim too early
    await expect(
      arcade.connect(p1).claim(wk, a1, proofFor(tree, 0))
    ).to.be.revertedWith("timelocked");

    // Advance past timelock (24h)
    await ethers.provider.send("evm_increaseTime", [24 * 3600 + 1]);
    await ethers.provider.send("evm_mine", []);

    const p1Bal = await ethers.provider.getBalance(p1.address);
    const tx = await arcade.connect(p1).claim(wk, a1, proofFor(tree, 0));
    const rc = await tx.wait();
    const gasUsed = rc.gasUsed * rc.gasPrice;
    const p1BalAfter = await ethers.provider.getBalance(p1.address);
    expect(p1BalAfter - p1Bal + gasUsed).to.equal(a1);

    // Double-claim rejected
    await expect(
      arcade.connect(p1).claim(wk, a1, proofFor(tree, 0))
    ).to.be.revertedWith("already claimed");

    // Bad proof rejected
    await expect(
      arcade.connect(p2).claim(wk, a2, proofFor(tree, 0))
    ).to.be.revertedWith("bad proof");
  });

  it("owner can veto settlement during timelock and roll funds forward", async () => {
    await arcade.connect(p1).enter({ value: ENTRY });
    const wk = await arcade.currentWeekId();
    const pool = await arcade.weekPool(wk);
    const leaves = [leafOf(p1.address, pool)];
    const tree = buildTree(leaves);
    const root = tree[tree.length - 1][0];

    await ethers.provider.send("evm_increaseTime", [7 * 24 * 3600 + 1]);
    await ethers.provider.send("evm_mine", []);
    await arcade.connect(operator).settleWeek(wk, root, pool);

    await arcade.connect(owner).vetoSettlement(wk);
    expect(await arcade.weekPool(wk)).to.equal(0);
    const nowWeek = await arcade.currentWeekId();
    expect(await arcade.weekPool(nowWeek)).to.equal(pool);

    await ethers.provider.send("evm_increaseTime", [24 * 3600 + 1]);
    await ethers.provider.send("evm_mine", []);
    await expect(
      arcade.connect(p1).claim(wk, pool, proofFor(tree, 0))
    ).to.be.revertedWith("vetoed");
  });

  it("sweepUnclaimed rolls stale prize into current pool", async () => {
    await arcade.connect(p1).enter({ value: ENTRY });
    const wk = await arcade.currentWeekId();
    const pool = await arcade.weekPool(wk);
    const leaves = [leafOf(p1.address, pool)];
    const tree = buildTree(leaves);
    const root = tree[tree.length - 1][0];

    await ethers.provider.send("evm_increaseTime", [7 * 24 * 3600 + 1]);
    await ethers.provider.send("evm_mine", []);
    await arcade.connect(operator).settleWeek(wk, root, pool);

    await expect(arcade.connect(owner).sweepUnclaimed(wk)).to.be.revertedWith("too early");

    await ethers.provider.send("evm_increaseTime", [4 * 7 * 24 * 3600 + 1]);
    await ethers.provider.send("evm_mine", []);
    await arcade.connect(owner).sweepUnclaimed(wk);
    expect(await arcade.weekPool(wk)).to.equal(0);
  });

  it("two-step ownership transfer", async () => {
    await arcade.connect(owner).transferOwnership(p1.address);
    expect(await arcade.owner()).to.equal(owner.address);
    await arcade.connect(p1).acceptOwnership();
    expect(await arcade.owner()).to.equal(p1.address);
  });

  it("operator rotation restricts settlement", async () => {
    await arcade.connect(owner).rotateOperator(p1.address);
    await arcade.connect(p2).enter({ value: ENTRY });
    const wk = await arcade.currentWeekId();
    await ethers.provider.send("evm_increaseTime", [7 * 24 * 3600 + 1]);
    await ethers.provider.send("evm_mine", []);
    await expect(
      arcade.connect(operator).settleWeek(wk, ethers.keccak256("0x01"), 0n)
    ).to.be.revertedWith("not operator");
  });
});

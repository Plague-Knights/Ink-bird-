// Minimal ABI fragment for the functions + events the frontend uses.
// Keep in sync with contracts/InkSquidArcade.sol.
export const InkSquidArcadeAbi = [
  { type: "function", name: "buyAttempts", stateMutability: "payable", inputs: [], outputs: [] },
  {
    type: "function", name: "settleWeek", stateMutability: "nonpayable",
    inputs: [
      { name: "weekId", type: "uint256" },
      { name: "root", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function", name: "attemptsBought", stateMutability: "view",
    inputs: [{ name: "player", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "claim", stateMutability: "nonpayable",
    inputs: [
      { name: "weekId", type: "uint256" },
      { name: "amount", type: "uint256" },
      { name: "proof", type: "bytes32[]" },
    ],
    outputs: [],
  },
  {
    type: "function", name: "currentWeekId", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "weeks_", stateMutability: "view",
    inputs: [{ name: "weekId", type: "uint256" }],
    outputs: [
      { name: "pool", type: "uint256" },
      { name: "playerShare", type: "uint256" },
      { name: "claimed", type: "uint256" },
      { name: "settledAt", type: "uint64" },
      { name: "root", type: "bytes32" },
    ],
  },
  {
    type: "function", name: "claimedByWeek", stateMutability: "view",
    inputs: [
      { name: "weekId", type: "uint256" },
      { name: "player", type: "address" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function", name: "weekEnd", stateMutability: "view",
    inputs: [{ name: "weekId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  { type: "function", name: "ENTRY_PRICE", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "ATTEMPTS_PER_PACK", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "event", name: "AttemptsBought", anonymous: false,
    inputs: [
      { name: "player", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
      { name: "attempts", type: "uint256", indexed: false },
      { name: "weekId", type: "uint256", indexed: true },
    ],
  },
  {
    type: "event", name: "Claimed", anonymous: false,
    inputs: [
      { name: "weekId", type: "uint256", indexed: true },
      { name: "player", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const;

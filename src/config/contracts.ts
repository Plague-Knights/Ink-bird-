import { ink, inkSepolia } from "./chains";

export interface ContractSet {
  arcade: `0x${string}`;
}

// Filled in after each environment's Ignition deploy. Update these after
// running `pnpm deploy:ink-testnet` / `pnpm deploy:ink` in the contracts repo.
export const CONTRACTS: Record<"testnet" | "mainnet", ContractSet> = {
  testnet: {
    arcade: "0x0000000000000000000000000000000000000000",
  },
  mainnet: {
    arcade: "0x0EcE8596af427a45e19e4A4e5c7068BcF3d7B912",
  },
};

export function getContracts(chainId: number | undefined): ContractSet {
  if (chainId === inkSepolia.id) return CONTRACTS.testnet;
  if (chainId === ink.id) return CONTRACTS.mainnet;
  return CONTRACTS.mainnet;
}

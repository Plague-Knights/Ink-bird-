import { createPublicClient, http } from "viem";
import { ink, inkSepolia } from "@/config/chains";
import { getContracts } from "@/config/contracts";

const network = process.env.NEXT_PUBLIC_INK_NETWORK ?? "sepolia";
export const activeChain = network === "mainnet" ? ink : inkSepolia;
export const activeContracts = getContracts(activeChain.id);

export const publicClient = createPublicClient({
  chain: activeChain,
  transport: http(),
});

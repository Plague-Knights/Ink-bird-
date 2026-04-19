import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { ink, inkSepolia } from "./chains";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";
const network = process.env.NEXT_PUBLIC_INK_NETWORK ?? "sepolia";

export const activeChain = network === "mainnet" ? ink : inkSepolia;

export const wagmiConfig = getDefaultConfig({
  appName: "Ink Squid",
  projectId,
  chains: [activeChain],
  ssr: true,
});

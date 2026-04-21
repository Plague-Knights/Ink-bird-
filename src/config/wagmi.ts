import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { ink, inkSepolia, soneiumMinato } from "./chains";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";
const network = process.env.NEXT_PUBLIC_INK_NETWORK ?? "sepolia";

// `activeChain` is the default chain the skill game targets. The
// chest game also supports Soneium Minato, so RainbowKit is given the
// full list and the user can switch in their wallet.
export const activeChain = network === "mainnet" ? ink : inkSepolia;

export const wagmiConfig = getDefaultConfig({
  appName: "Ink Squid",
  projectId,
  chains: [activeChain, soneiumMinato],
  ssr: true,
});

import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { ink, inkSepolia, soneium, soneiumMinato } from "./chains";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";
const network = process.env.NEXT_PUBLIC_INK_NETWORK ?? "sepolia";

// `activeChain` is the default chain the skill game targets. The
// unified InkSquidGame can run on any of the 4 EVM chains we support,
// so RainbowKit is given the full list and the user can switch in
// their wallet. Mainnet chains are listed first so wallets default to
// mainnet when a player has both available.
export const activeChain = network === "mainnet" ? ink : inkSepolia;

export const wagmiConfig = getDefaultConfig({
  appName: "Ink Squid",
  projectId,
  chains: [ink, soneium, inkSepolia, soneiumMinato],
  ssr: true,
});

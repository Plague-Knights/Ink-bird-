import { ChestsGame } from "@/components/ChestsGame";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Ink Squid",
  description: "Auto-flap through the pipes while the contract rolls one outcome. 92.8% RTP with commit-reveal fairness.",
};

export default function Home() {
  // ChestsGame owns its own fullscreen layout (position: fixed, inset: 0)
  // so the page wrapper just renders it; the brand header, mode toggle,
  // and info drawer all live inside ChestsGame now.
  return <ChestsGame />;
}

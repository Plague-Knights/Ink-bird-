import { redirect } from "next/navigation";

// Production entry: Squid Cannon is the live game. The Flappy prototype
// still lives at /flappy for the weekly settlement to finish paying out.
export default function Home() {
  redirect("/cannon");
}

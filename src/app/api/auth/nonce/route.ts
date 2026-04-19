import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

function randomNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function POST() {
  const session = await getSession();
  session.nonce = randomNonce();
  await session.save();
  return NextResponse.json({ nonce: session.nonce });
}

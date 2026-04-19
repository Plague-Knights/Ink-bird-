import { NextResponse } from "next/server";
import { parseSiweMessage } from "viem/siwe";

import { publicClient } from "@/lib/chain";
import { getSession } from "@/lib/session";

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session.nonce) {
      return NextResponse.json({ error: "No active nonce" }, { status: 400 });
    }

    let message: string;
    let signature: `0x${string}`;
    try {
      const body = await req.json();
      message = body.message;
      signature = body.signature;
    } catch {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }
    if (typeof message !== "string" || typeof signature !== "string") {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    const parsed = parseSiweMessage(message);
    if (!parsed.address || !parsed.nonce) {
      return NextResponse.json({ error: "Malformed SIWE message" }, { status: 400 });
    }
    if (parsed.nonce !== session.nonce) {
      return NextResponse.json({ error: "Nonce mismatch" }, { status: 401 });
    }

    const valid = await publicClient.verifySiweMessage({ message, signature });
    if (!valid) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    session.address = parsed.address;
    session.chainId = parsed.chainId;
    session.issuedAt = Date.now();
    session.nonce = undefined;
    await session.save();

    return NextResponse.json({ address: session.address });
  } catch (e) {
    // Log details server-side so the 500 is debuggable in Railway logs.
    console.error("[auth/verify] failure", e);
    return NextResponse.json(
      { error: "Internal error", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

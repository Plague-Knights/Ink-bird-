import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";

export type SessionData = {
  nonce?: string;
  address?: `0x${string}`;
  chainId?: number;
  issuedAt?: number;
  pendingReferrer?: `0x${string}`;
};

const secret = process.env.SESSION_SECRET;
if (!secret || secret.length < 32) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET must be set and at least 32 characters");
  }
}

export const sessionOptions: SessionOptions = {
  password: secret ?? "development-only-secret-development-only",
  cookieName: "ink-squid-session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    httpOnly: true,
    path: "/",
  },
};

export async function getSession() {
  const store = await cookies();
  return getIronSession<SessionData>(store, sessionOptions);
}

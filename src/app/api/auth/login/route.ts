import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";

const COOKIE = "pv_session";

// ---------------------------------------------------------------------------
// In-memory rate limiting (dependency-free).
// Sliding window of failed-login timestamps per client IP (x-forwarded-for).
// NOTE: this state lives in this process's memory only — a multi-instance
// deploy (e.g. several Vercel functions) would need a shared store such as
// Redis/Vercel KV for the limit to be enforced globally.
// ---------------------------------------------------------------------------
const MAX_FAILED_ATTEMPTS = 10;
const FAILED_WINDOW_MS = 5 * 60 * 1000;
/** Sweep cap so spoofed x-forwarded-for values can't grow the map unbounded. */
const MAX_TRACKED_IPS = 1000;

const failedLogins = new Map<string, number[]>();

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || "unknown";
}

/** Drop entries older than the window; returns the still-relevant timestamps. */
function pruneStamps(stamps: number[], now: number): number[] {
  return stamps.filter((t) => now - t < FAILED_WINDOW_MS);
}

/** Periodic sweep when the map gets large (cheap; only failed IPs are stored). */
function sweepExpired(now: number): void {
  for (const [ip, stamps] of failedLogins) {
    if (pruneStamps(stamps, now).length === 0) {
      failedLogins.delete(ip);
    }
  }
}

async function sessionToken(): Promise<string> {
  const pw = process.env.APP_PASSWORD ?? "";
  const data = new TextEncoder().encode(`pv::${pw}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time password check: compare SHA-256 digests instead of the raw
 * strings, so both buffers are always 32 bytes (timingSafeEqual throws on a
 * length mismatch) and no early exit leaks how many leading chars matched. */
function passwordsMatch(candidate: string, expected: string): boolean {
  const a = createHash("sha256").update(candidate, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const pw = process.env.APP_PASSWORD;
  if (!pw) {
    return NextResponse.json(
      { error: "APP_PASSWORD is not configured on the server." },
      { status: 500 },
    );
  }

  const body = await req.json().catch(() => null);
  const password = body?.password;
  if (typeof password !== "string") {
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  const ip = clientIp(req);
  const now = Date.now();
  if (failedLogins.size > MAX_TRACKED_IPS) {
    sweepExpired(now);
  }
  const stamps = pruneStamps(failedLogins.get(ip) ?? [], now);
  if (stamps.length === 0) {
    failedLogins.delete(ip);
  } else {
    failedLogins.set(ip, stamps);
  }
  if (stamps.length >= MAX_FAILED_ATTEMPTS) {
    const minutes = Math.ceil(FAILED_WINDOW_MS / 60_000);
    return NextResponse.json(
      {
        error: `Too many failed login attempts. Please wait ${minutes} minutes and try again.`,
      },
      { status: 429 },
    );
  }

  if (!passwordsMatch(password, pw)) {
    stamps.push(now);
    failedLogins.set(ip, stamps);
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  // Success resets the failure count for this IP.
  failedLogins.delete(ip);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, await sessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  return res;
}

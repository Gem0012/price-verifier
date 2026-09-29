import { NextRequest, NextResponse } from "next/server";

const COOKIE = "pv_session";

async function sessionToken(): Promise<string> {
  const pw = process.env.APP_PASSWORD ?? "";
  const data = new TextEncoder().encode(`pv::${pw}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // A missing APP_PASSWORD would make the session cookie publicly derivable
  // (sha256("pv::")) — refuse to serve protected routes instead.
  if (!process.env.APP_PASSWORD && !pathname.startsWith("/login")) {
    return new NextResponse(
      "Server misconfigured: APP_PASSWORD is not set. Set it in .env.local (dev) or the host's environment variables.",
      { status: 500 },
    );
  }

  // Login screen and auth endpoints are always reachable.
  if (pathname.startsWith("/login") || pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  const token = req.cookies.get(COOKIE)?.value;
  if (token && token === (await sessionToken())) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next|favicon.ico|icon.svg).*)"],
};

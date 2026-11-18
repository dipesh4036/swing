import { NextResponse } from "next/server";
import { jwtVerify } from "jose";

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  const isApi = pathname.startsWith("/api/");
  const isPublicApi = pathname === "/api/auth/login" || pathname === "/api/health";
  const isPublicPage = pathname === "/login";
  const isStaticAsset =
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    pathname === "/icon.svg" ||
    (!isApi && /\.(svg|png|jpg|jpeg|gif|webp|ico|css|js|txt|xml|woff|woff2)$/i.test(pathname));

  const isPublic = isPublicApi || isPublicPage || isStaticAsset;

  // 2. Verify auth session cookie
  const token = request.cookies.get("auth_session")?.value;
  let isAuthenticated = false;

  const authSecret = process.env.AUTH_SECRET || process.env.JWT_SECRET;
  if (token && authSecret) {
    try {
      const secret = new TextEncoder().encode(authSecret);
      await jwtVerify(token, secret, { algorithms: ["HS256"] });
      isAuthenticated = true;
    } catch {
      isAuthenticated = false;
    }
  }

  // If user is already authenticated and visits /login, redirect to homepage
  if (pathname === "/login" && isAuthenticated) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // Allow public requests
  if (isPublic) {
    return NextResponse.next();
  }

  // Allow authenticated requests
  if (isAuthenticated) {
    return NextResponse.next();
  }

  // 3. Unauthorized handling
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  // Redirect unauthenticated page requests to /login
  const loginUrl = new URL("/login", request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, icon.svg
     */
    "/((?!_next/static|_next/image|favicon.ico|icon.svg).*)",
  ],
};

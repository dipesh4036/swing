
import { NextResponse } from "next/server";
import { queryWithRetry } from "@/lib/db";
import {
  AUTH_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  comparePassword,
  signSessionToken,
  hashIp,
  extractClientIp,
} from "@/lib/auth";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { email, password } = body;

    const ip = extractClientIp(request);
    const ipHash = hashIp(ip);
    const cleanEmail = typeof email === "string" ? email.toLowerCase().trim() : "";

    if (!cleanEmail || !password || typeof password !== "string") {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    // 1. Lockout check: > 5 failed attempts for same email OR same ip_hash in 15 minutes
    const lockoutRes = await queryWithRetry(
      `SELECT COUNT(*) as failed_count
       FROM login_attempts
       WHERE (email = $1 OR ip_hash = $2)
         AND success = false
         AND attempted_at >= NOW() - INTERVAL '15 minutes';`,
      [cleanEmail, ipHash]
    );

    const failedCount = parseInt(lockoutRes.rows[0]?.failed_count || "0", 10);
    if (failedCount >= 5) {
      return NextResponse.json(
        { error: "Too many failed login attempts. Please try again later." },
        { status: 429 }
      );
    }

    // 2. Clean up login_attempts older than 7 days
    try {
      await queryWithRetry(
        `DELETE FROM login_attempts WHERE attempted_at < NOW() - INTERVAL '7 days';`,
        []
      );
    } catch (cleanupErr) {
      console.warn("Notice: Failed to prune old login attempts:", cleanupErr.message);
    }

    // 3. User lookup
    const userRes = await queryWithRetry(
      `SELECT id, email, password_hash FROM app_users WHERE email = $1 LIMIT 1;`,
      [cleanEmail]
    );

    const user = userRes.rows[0] || null;

    // Constant-time compare: compares against dummy hash if user does not exist
    const isMatch = await comparePassword(password, user ? user.password_hash : null);

    if (!user || !isMatch) {
      // Record failed attempt
      await queryWithRetry(
        `INSERT INTO login_attempts (email, ip_hash, success) VALUES ($1, $2, false);`,
        [cleanEmail, ipHash]
      );

      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    // Record successful attempt
    await queryWithRetry(
      `INSERT INTO login_attempts (email, ip_hash, success) VALUES ($1, $2, true);`,
      [cleanEmail, ipHash]
    );

    // 4. Issue signed JWT session cookie
    const token = await signSessionToken({
      id: user.id,
      userId: user.id,
      email: user.email,
    });

    const response = NextResponse.json({
      success: true,
      email: user.email,
    });

    response.cookies.set({
      name: AUTH_COOKIE_NAME,
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });

    return response;
  } catch (err) {
    console.error("Auth login error:", err);
    return NextResponse.json(
      { error: "An unexpected error occurred during authentication." },
      { status: 500 }
    );
  }
}

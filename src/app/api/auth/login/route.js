
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

    // 1. Record attempt up front with success=false BEFORE password check to prevent parallel race conditions
    const attemptRes = await queryWithRetry(
      `INSERT INTO login_attempts (email, ip_hash, success) VALUES ($1, $2, false) RETURNING id;`,
      [cleanEmail, ipHash]
    );
    const attemptId = attemptRes.rows[0]?.id;

    // 2. Lockout check including this newly recorded attempt
    // Block when failures from same ip_hash > 5 in 15 minutes, or failures for same email from same ip_hash > 5.
    // Per-email failures from other IPs: after 20 in 15 minutes return 429 only for requests from IPs not seen with a successful login for that email.
    const lockoutRes = await queryWithRetry(
      `SELECT
         COUNT(*) FILTER (WHERE ip_hash = $2 AND success = false AND attempted_at >= NOW() - INTERVAL '15 minutes') as ip_failed_count,
         COUNT(*) FILTER (WHERE email = $1 AND ip_hash = $2 AND success = false AND attempted_at >= NOW() - INTERVAL '15 minutes') as email_ip_failed_count,
         COUNT(*) FILTER (WHERE email = $1 AND success = false AND attempted_at >= NOW() - INTERVAL '15 minutes') as email_failed_count,
         COUNT(*) FILTER (WHERE email = $1 AND ip_hash = $2 AND success = true) as known_ip_success_count
       FROM login_attempts
       WHERE (email = $1 OR ip_hash = $2);`,
      [cleanEmail, ipHash]
    );

    const lockoutRow = lockoutRes.rows[0];
    const ipFailed = parseInt(lockoutRow?.ip_failed_count || "0", 10);
    const emailIpFailed = parseInt(lockoutRow?.email_ip_failed_count || "0", 10);
    const emailFailed = parseInt(lockoutRow?.email_failed_count || "0", 10);
    const hasKnownSuccess = parseInt(lockoutRow?.known_ip_success_count || "0", 10) > 0;

    if (ipFailed > 5 || emailIpFailed > 5) {
      return NextResponse.json(
        { error: "Too many failed login attempts. Please try again later." },
        { status: 429 }
      );
    }

    if (emailFailed > 20 && !hasKnownSuccess) {
      return NextResponse.json(
        { error: "Too many failed login attempts. Please try again later." },
        { status: 429 }
      );
    }

    // 3. Clean up login_attempts older than 7 days
    try {
      await queryWithRetry(
        `DELETE FROM login_attempts WHERE attempted_at < NOW() - INTERVAL '7 days';`,
        []
      );
    } catch (cleanupErr) {
      console.warn("Notice: Failed to prune old login attempts:", cleanupErr.message);
    }

    // 4. User lookup
    const userRes = await queryWithRetry(
      `SELECT id, email, password_hash FROM app_users WHERE email = $1 LIMIT 1;`,
      [cleanEmail]
    );

    const user = userRes.rows[0] || null;

    // Constant-time compare: compares against dummy hash if user does not exist
    const isMatch = await comparePassword(password, user ? user.password_hash : null);

    if (!user || !isMatch) {
      // Failed attempt is already recorded with success=false at step 1
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    // On success: update the recorded attempt to success=true
    if (attemptId) {
      await queryWithRetry(
        `UPDATE login_attempts SET success = true WHERE id = $1;`,
        [attemptId]
      );
    }

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
    if (err.message && err.message.includes("AUTH_SECRET")) {
      return NextResponse.json(
        { error: "Server authentication secret is not configured in production environment variables (AUTH_SECRET)." },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { error: "An unexpected error occurred during authentication." },
      { status: 500 }
    );
  }
}

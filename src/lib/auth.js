import crypto from "crypto";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";

export const AUTH_COOKIE_NAME = "auth_session";
export const SESSION_EXPIRY = "7d";
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // 7 days

// Cost 12 dummy hash for constant-time comparison when user not found
export const DUMMY_HASH = "$2a$12$e80yq7K3O96Xk1lQv/Qn0.fH3qZ9X8P8.l9z2nQvP1bY6xY5y1a9O";

export function getAuthSecret() {
  const secret = process.env.AUTH_SECRET || process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET must be set and at least 32 characters long.");
  }
  return new TextEncoder().encode(secret);
}

export async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

export async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash || DUMMY_HASH);
}

export async function signSessionToken(payload) {
  const secret = getAuthSecret();
  const builder = new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(SESSION_EXPIRY);

  if (payload.id) {
    builder.setSubject(String(payload.id));
  } else if (payload.sub) {
    builder.setSubject(String(payload.sub));
  }

  return builder.sign(secret);
}

export async function verifySessionToken(token) {
  if (!token) return null;
  try {
    const secret = getAuthSecret();
    const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
    return payload;
  } catch {
    return null;
  }
}

export function hashIp(ip) {
  const secret = getAuthSecret();
  const clientIp = ip || "127.0.0.1";
  return crypto.createHmac("sha256", secret).update(clientIp).digest("hex");
}

export function extractClientIp(request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return request.headers.get("x-real-ip") || "127.0.0.1";
}

/**
 * Parses cookies from raw Cookie header string if cookies API is unavailable
 */
export function parseCookies(cookieHeader) {
  if (!cookieHeader) return {};
  const cookies = {};
  for (const pair of cookieHeader.split(";")) {
    const [key, ...values] = pair.trim().split("=");
    if (key) {
      cookies[key] = decodeURIComponent(values.join("="));
    }
  }
  return cookies;
}

/**
 * Checks authentication for API route handlers (defence in depth)
 * Returns the authenticated user payload, or null if unauthorized.
 */
export async function requireAuth(request) {
  let token = null;

  if (request.cookies && typeof request.cookies.get === "function") {
    token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  }

  if (!token) {
    const rawHeader = request.headers.get("cookie");
    const parsed = parseCookies(rawHeader);
    token = parsed[AUTH_COOKIE_NAME];
  }

  if (!token) {
    return null;
  }

  return verifySessionToken(token);
}

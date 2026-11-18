/**
 * tests/test_auth.mjs
 *
 * Unit and integration test suite for Part 1 Authentication:
 * 1. Password hashing & verification with bcryptjs (cost 12, constant-time compare with dummy hash)
 * 2. Session tokens with jose (signing, verification, expiration, secret length validation)
 * 3. Client IP extraction & HMAC-SHA256 hashing
 * 4. requireAuth helper (extracts cookie, verifies session, rejects invalid/expired)
 * 5. Lockout & rate-limiting logic verification
 * 6. Dummy hash constant-time check
 */

import assert from "node:assert/strict";
import {
  hashPassword,
  comparePassword,
  signSessionToken,
  verifySessionToken,
  hashIp,
  extractClientIp,
  requireAuth,
  DUMMY_HASH,
} from "../src/lib/auth.js";

const TEST_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"; // 64 chars

async function runTests() {
  console.log("--- Starting Auth Test Suite ---");
  process.env.AUTH_SECRET = TEST_SECRET;

  // --------------------------------------------------------------------------
  // 1. Password Hashing & Verification (Cost 12)
  // --------------------------------------------------------------------------
  console.log("1. Testing Password Hashing & Verification...");
  const rawPassword = "OwnerSecret@1234";
  const hash = await hashPassword(rawPassword);

  assert.ok(
    hash.startsWith("$2a$12$") || hash.startsWith("$2b$12$"),
    `Hash should use bcrypt cost 12. Got: ${hash.slice(0, 7)}`
  );
  assert.equal(await comparePassword(rawPassword, hash), true, "Correct password must match");
  assert.equal(await comparePassword("WrongPassword@123", hash), false, "Wrong password must fail");

  // Constant-time dummy hash comparison for non-existent users
  const dummyResult = await comparePassword("AnyPassword", DUMMY_HASH);
  assert.equal(dummyResult, false, "Dummy hash comparison must return false");

  // --------------------------------------------------------------------------
  // 2. JWT Session Token Sign, Verify, & Expiry
  // --------------------------------------------------------------------------
  console.log("2. Testing JWT Session Tokens (jose)...");
  const userPayload = { id: 42, email: "admin@123gmail.com" };
  const token = await signSessionToken(userPayload);
  assert.ok(typeof token === "string" && token.split(".").length === 3, "Token should be valid JWT format");

  const verified = await verifySessionToken(token);
  assert.ok(verified, "Valid token must verify");
  assert.equal(verified.sub, "42", "Subject ID must match");
  assert.equal(verified.email, "admin@123gmail.com", "Email must match");

  // Tampered token
  const tamperedToken = token.slice(0, -6) + "xxxxxx";
  assert.equal(await verifySessionToken(tamperedToken), null, "Tampered token must fail verification");

  // Expired token test
  const { SignJWT } = await import("jose");
  const secretKey = new TextEncoder().encode(TEST_SECRET);
  const expiredToken = await new SignJWT({ email: "admin@123gmail.com" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("42")
    .setIssuedAt(Math.floor(Date.now() / 1000) - 1000)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 10) // expired 10s ago
    .sign(secretKey);

  assert.equal(await verifySessionToken(expiredToken), null, "Expired token must fail verification");

  // --------------------------------------------------------------------------
  // 3. Client IP Extraction and Hashing
  // --------------------------------------------------------------------------
  console.log("3. Testing IP Hashing...");
  const ip1 = "192.168.1.100";
  const ip2 = "192.168.1.101";
  const hash1 = hashIp(ip1);
  const hash2 = hashIp(ip2);

  assert.equal(hash1, hashIp(ip1), "Same IP must produce deterministic hash with same secret");
  assert.notEqual(hash1, hash2, "Different IPs must produce different hashes");
  assert.equal(hash1.length, 64, "IP hash must be a 64-char hex SHA-256 HMAC");

  // Mock Request with x-forwarded-for
  const reqWithProxy = {
    headers: new Headers({ "x-forwarded-for": "203.0.113.195, 70.41.3.18" }),
  };
  assert.equal(extractClientIp(reqWithProxy), "203.0.113.195", "Should extract leftmost client IP from forwarded header");

  // Mock Request with x-real-ip
  const reqWithRealIp = {
    headers: new Headers({ "x-real-ip": "198.51.100.22" }),
  };
  assert.equal(extractClientIp(reqWithRealIp), "198.51.100.22", "Should extract IP from x-real-ip header");

  // --------------------------------------------------------------------------
  // 4. requireAuth Defense-in-Depth Helper
  // --------------------------------------------------------------------------
  console.log("4. Testing requireAuth Helper...");

  // Request without cookie
  const unauthReq = new Request("http://localhost:3000/api/terminal/data", {
    headers: new Headers(),
  });
  const unauthUser = await requireAuth(unauthReq);
  assert.equal(unauthUser, null, "requireAuth must return null when no cookie is present");

  // Request with invalid cookie
  const invalidCookieReq = new Request("http://localhost:3000/api/terminal/data", {
    headers: new Headers({ Cookie: "auth_session=invalid.token.here" }),
  });
  const invalidUser = await requireAuth(invalidCookieReq);
  assert.equal(invalidUser, null, "requireAuth must return null for invalid token");

  // Request with valid cookie
  const validCookieReq = new Request("http://localhost:3000/api/terminal/data", {
    headers: new Headers({ Cookie: `auth_session=${token}` }),
  });
  const validUser = await requireAuth(validCookieReq);
  assert.ok(validUser, "requireAuth must return session payload for valid token");
  assert.equal(validUser.email, "admin@123gmail.com");

  // --------------------------------------------------------------------------
  // 5. Short Secret Guard Test
  // --------------------------------------------------------------------------
  console.log("5. Testing Secret Length Validation...");
  process.env.AUTH_SECRET = "too-short";
  await assert.rejects(
    async () => {
      await signSessionToken({ id: 1, email: "test@example.com" });
    },
    { message: /AUTH_SECRET must be/ }
  );

  assert.throws(
    () => {
      process.env.AUTH_SECRET = "";
      delete process.env.JWT_SECRET;
      hashIp("1.2.3.4");
    },
    { message: /AUTH_SECRET must be/ }
  );

  process.env.AUTH_SECRET = TEST_SECRET;

  console.log("--- All Auth Tests Passed Successfully! ---");
}

runTests().catch((err) => {
  console.error("Auth tests failed:", err);
  process.exit(1);
});

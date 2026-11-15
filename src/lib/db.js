import { Pool } from "pg";

let pool;

export function getDbPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set.");
    }
    pool = new Pool({
      connectionString,
      ssl: {
        rejectUnauthorized: false,
      },
      max: 2, // Max 2 pooled connections for Neon serverless free tier
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
  }
  return pool;
}

export async function queryWithRetry(text, params, maxRetries = 1) {
  const p = getDbPool();
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await p.query(text, params);
    } catch (err) {
      lastErr = err;
      // If database is waking from idle sleep or connection timed out, wait 1s and retry once
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }
  throw lastErr;
}

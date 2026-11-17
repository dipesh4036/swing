#!/usr/bin/env node

/**
 * scripts/create-user.mjs
 * 
 * One-time local script to create the single owner account in app_users.
 * Reads email from CLI argument and password from hidden interactive prompt.
 * Uses ADMIN_DATABASE_URL (or DATABASE_URL) with owner permissions.
 */

import readline from "node:readline";
import { Writable } from "node:stream";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import bcrypt from "bcryptjs";

// Load .env or .env.local if present
function loadEnv() {
  const envFiles = [".env.local", ".env"];
  for (const file of envFiles) {
    const fullPath = path.resolve(process.cwd(), file);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx !== -1) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    }
  }
}

loadEnv();

let pipedLines = null;
let pipedIndex = 0;

async function getPipedLine() {
  if (pipedLines === null) {
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const fullText = Buffer.concat(chunks).toString("utf-8");
    pipedLines = fullText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  }
  return pipedLines[pipedIndex++];
}

function promptHidden(query) {
  if (!process.stdin.isTTY) {
    return getPipedLine();
  }

  return new Promise((resolve, reject) => {
    let muted = false;
    const mutableStdout = new Writable({
      write(chunk, encoding, callback) {
        if (!muted) {
          process.stdout.write(chunk, encoding);
        }
        callback();
      },
    });

    const rl = readline.createInterface({
      input: process.stdin,
      output: mutableStdout,
      terminal: true,
    });

    process.stdout.write(query);
    muted = true;

    rl.question("", (answer) => {
      process.stdout.write("\n");
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const replace = args.includes("--replace");
  const emailArg = args.find((a) => !a.startsWith("--"));

  if (!emailArg) {
    console.error("Usage: node scripts/create-user.mjs <email> [--replace]");
    process.exit(1);
  }

  const email = emailArg.toLowerCase().trim();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    console.error("Error: Invalid email format.");
    process.exit(1);
  }

  const dbUrl = process.env.ADMIN_DATABASE_URL || process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("Error: Neither ADMIN_DATABASE_URL nor DATABASE_URL is set in environment.");
    process.exit(1);
  }

  const client = new pg.Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    // Check if a user already exists
    const checkRes = await client.query("SELECT COUNT(*) as count FROM app_users;");
    const count = parseInt(checkRes.rows[0].count, 10);

    if (count > 0 && !replace) {
      console.error("Refusing to run: A user already exists. Pass --replace to overwrite.");
      process.exit(1);
    }

    // Read password securely from hidden interactive prompt
    const password = await promptHidden("Enter password: ");
    if (!password || password.length < 8) {
      console.error("Error: Password must be at least 8 characters long.");
      process.exit(1);
    }

    const confirmPassword = await promptHidden("Confirm password: ");
    if (password !== confirmPassword) {
      console.error("Error: Passwords do not match.");
      process.exit(1);
    }

    // Cost 12 bcrypt hash
    const passwordHash = await bcrypt.hash(password, 12);

    if (replace) {
      await client.query("DELETE FROM app_users;");
    }

    await client.query(
      "INSERT INTO app_users (email, password_hash) VALUES ($1, $2);",
      [email, passwordHash]
    );

    console.log(`User ${email} created successfully.`);
  } catch (err) {
    console.error("Failed to create user:", err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();


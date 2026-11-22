import { NextResponse } from "next/server";
import { queryWithRetry } from "@/lib/db";

function getWeekdayDifference(startDateStr) {
  if (!startDateStr) return null;
  const start = new Date(startDateStr);
  const now = new Date();

  // Normalize dates to midnight UTC to compare calendar days
  const startUTC = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const nowUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  let weekdays = 0;
  const cur = new Date(startUTC);
  cur.setUTCDate(cur.getUTCDate() + 1);

  while (cur <= nowUTC) {
    const day = cur.getUTCDay();
    if (day !== 0 && day !== 6) { // not Sunday (0) or Saturday (6)
      weekdays++;
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return weekdays;
}

async function sendTelegramAlert(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.warn("Telegram bot token or chat ID not set on Vercel; skipping alert.");
    return false;
  }
  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const cleanText = `[Pipeline Alert] ${String(text || "").trim()}`.slice(0, 3500);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: cleanText,
      }),
    });
    if (!res.ok) {
      let desc = "";
      try {
        const errJson = await res.json();
        desc = errJson?.description || "";
      } catch (_) {
        desc = res.statusText;
      }
      console.error(`Telegram alert failed: status=${res.status}, description=${desc}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Failed to send Telegram alert from health check:", err?.message || err);
    return false;
  }
}

export async function GET(request) {
  // 1. Verify CRON_SECRET is configured; return 500 if unset to prevent unauthenticated access
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "Server misconfigured: CRON_SECRET environment variable is missing" },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 2. Query latest trade_date from daily_market_breadth
    const breadthRes = await queryWithRetry(
      "SELECT MAX(trade_date) as latest_date FROM daily_market_breadth;"
    );
    const rawDate = breadthRes.rows[0]?.latest_date;
    const latestDate = rawDate ? new Date(rawDate).toISOString().split("T")[0] : null;

    // 3. Query latest ingest_runs status
    const ingestRes = await queryWithRetry(`
      SELECT run_id, status, quality_gate_passed, completed_at, error_message
      FROM ingest_runs
      ORDER BY run_id DESC
      LIMIT 1;
    `);
    const latestIngest = ingestRes.rows[0] || null;

    // 4. Query latest trade_date from daily_fii_dii_cash and daily_macro_rates (R20)
    let fiiDiiLatestDate = null;
    try {
      const fiiDiiRes = await queryWithRetry(
        "SELECT MAX(trade_date) as latest_date FROM daily_fii_dii_cash;"
      );
      const rawFiiDii = fiiDiiRes.rows[0]?.latest_date;
      fiiDiiLatestDate = rawFiiDii ? new Date(rawFiiDii).toISOString().split("T")[0] : null;
    } catch (fiiErr) {
      console.warn("Could not query daily_fii_dii_cash latest date:", fiiErr.message);
    }
    const fiiDiiStaleDays = getWeekdayDifference(fiiDiiLatestDate);

    let macroLatestDate = null;
    try {
      const macroRes = await queryWithRetry(
        "SELECT MAX(trade_date) as latest_date FROM daily_macro_rates;"
      );
      const rawMacro = macroRes.rows[0]?.latest_date;
      macroLatestDate = rawMacro ? new Date(rawMacro).toISOString().split("T")[0] : null;
    } catch (macroErr) {
      console.warn("Could not query daily_macro_rates latest date:", macroErr.message);
    }
    const macroStaleDays = getWeekdayDifference(macroLatestDate);

    let sectorLatestDate = null;
    try {
      const sectorRes = await queryWithRetry(
        "SELECT MAX(trade_date) as latest_date FROM daily_sector_breadth;"
      );
      const rawSector = sectorRes.rows[0]?.latest_date;
      sectorLatestDate = rawSector ? new Date(rawSector).toISOString().split("T")[0] : null;
    } catch (secErr) {
      console.warn("Could not query daily_sector_breadth latest date:", secErr.message);
    }
    const sectorStaleDays = getWeekdayDifference(sectorLatestDate);

    let isDegraded = false;
    const failureReasons = [];

    // Check weekday staleness (> 3 weekdays stale degrades health)
    if (fiiDiiStaleDays !== null && fiiDiiStaleDays > 3) {
      isDegraded = true;
      failureReasons.push(
        `FII/DII cash flow data is ${fiiDiiStaleDays} weekdays stale (latest: ${fiiDiiLatestDate}).`
      );
    }

    if (macroStaleDays !== null && macroStaleDays > 3) {
      isDegraded = true;
      failureReasons.push(
        `Macro rates data is ${macroStaleDays} weekdays stale (latest: ${macroLatestDate}).`
      );
    }

    // T13.2: Sector breadth is derived from breadth; degraded if > 1 session behind breadth
    if (latestDate && sectorLatestDate && sectorLatestDate < latestDate) {
      isDegraded = true;
      failureReasons.push(
        `Sector breadth data is lagging market breadth: sector asOf ${sectorLatestDate} vs breadth asOf ${latestDate}.`
      );
    } else if (sectorStaleDays !== null && sectorStaleDays > 1) {
      isDegraded = true;
      failureReasons.push(
        `Sector breadth data is ${sectorStaleDays} weekdays stale (latest: ${sectorLatestDate}).`
      );
    }

    // Check calendar age of latest breadth data
    let daysOld = null;
    if (latestDate) {
      const now = new Date();
      const last = new Date(latestDate);
      daysOld = Math.floor((now.getTime() - last.getTime()) / (1000 * 60 * 60 * 24));
      if (daysOld > 4) {
        isDegraded = true;
        failureReasons.push(
          `Market breadth data is ${daysOld} days old (latest: ${latestDate}). GitHub Actions may have paused scheduled runs due to 60 days repository inactivity. Push a commit or trigger workflow manually.`
        );
      }
    } else {
      isDegraded = true;
      failureReasons.push("No breadth records found in daily_market_breadth.");
    }

    // Check if latest ingest run failed or quality gate failed
    if (latestIngest) {
      if (latestIngest.status === "failed" || latestIngest.quality_gate_passed === false) {
        isDegraded = true;
        failureReasons.push(
          `Latest pipeline ingest run #${latestIngest.run_id} failed: ${latestIngest.error_message || "Quality gate failed"}`
        );
      }
    }

    // Check GitHub repo inactivity (GitHub Actions pauses scheduled runs after 60 days without commits - R4)
    let commitDaysOld = null;
    let commitWarning = null;
    let githubCheck = "ok";
    try {
      const repo = process.env.GITHUB_REPO || "dipesh4036/swing";
      const branch = process.env.GITHUB_BRANCH || "v1";
      const ghHeaders = {
        "User-Agent": "MarketBreadth-HealthCheck",
        Accept: "application/vnd.github+json",
      };
      if (process.env.GITHUB_TOKEN) {
        ghHeaders["Authorization"] = `Bearer ${process.env.GITHUB_TOKEN}`;
      }
      const ghRes = await fetch(`https://api.github.com/repos/${repo}/commits/${encodeURIComponent(branch)}`, {
        headers: ghHeaders,
      });
      if (ghRes.ok) {
        const ghData = await ghRes.json();
        const dateStr = ghData.commit?.committer?.date || ghData.commit?.author?.date;
        if (dateStr) {
          const commitDate = new Date(dateStr);
          commitDaysOld = Math.floor((new Date().getTime() - commitDate.getTime()) / (1000 * 60 * 60 * 24));
          if (commitDaysOld >= 45) {
            const daysRemaining = Math.max(0, 60 - commitDaysOld);
            commitWarning = `GitHub Actions will pause scheduled runs in ${daysRemaining} days. Push any commit to reset the timer.`;
            isDegraded = true;
            failureReasons.push(commitWarning);
          }
        }
      } else {
        githubCheck = "unavailable";
        console.warn(`Could not check commit inactivity via GitHub API: status=${ghRes.status}`);
      }
    } catch (ghErr) {
      githubCheck = "unavailable";
      console.warn("Could not check commit inactivity via GitHub API:", ghErr.message);
    }

    let alertSent = false;
    // 4. Send Telegram alert at most once per calendar day (R3: plain text)
    if (isDegraded) {
      // Ensure health_alerts table exists
      await queryWithRetry(`
        CREATE TABLE IF NOT EXISTS health_alerts (
          alert_date DATE PRIMARY KEY,
          alert_msg TEXT,
          sent_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);

      const alreadyAlerted = await queryWithRetry(
        "SELECT alert_date FROM health_alerts WHERE alert_date = CURRENT_DATE;"
      );

      if (alreadyAlerted.rows.length === 0) {
        const alertMsg = failureReasons.map((r) => `• ${r}`).join("\n\n");
        const sent = await sendTelegramAlert(alertMsg);
        if (sent) {
          alertSent = true;
          await queryWithRetry(
            "INSERT INTO health_alerts (alert_date, alert_msg) VALUES (CURRENT_DATE, $1) ON CONFLICT DO NOTHING;",
            [alertMsg]
          );
        }
      }
    }

    const resJson = {
      status: isDegraded ? "degraded" : "healthy",
      latestBreadthDate: latestDate,
      daysSinceLastBreadth: daysOld,
      daysSinceLastCommit: commitDaysOld,
      fiiDiiStaleDays,
      macroStaleDays,
      sectorStaleDays,
      sectorLatestDate,
      latestIngestRun: latestIngest
        ? {
            runId: latestIngest.run_id,
            status: latestIngest.status,
            qualityGatePassed: latestIngest.quality_gate_passed,
            completedAt: latestIngest.completed_at,
          }
        : null,
      issues: failureReasons,
      alertSentToday: alertSent,
      timestamp: new Date().toISOString(),
    };
    if (githubCheck !== "ok") {
      resJson.githubCheck = "unavailable";
    }

    return NextResponse.json(resJson);
  } catch (error) {
    console.error("Health check error:", error);
    return NextResponse.json(
      {
        status: "unreachable",
        error: error.message,
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}

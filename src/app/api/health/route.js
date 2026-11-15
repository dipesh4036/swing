import { NextResponse } from "next/server";
import { queryWithRetry } from "@/lib/db";

async function sendTelegramAlert(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.warn("Telegram bot token or chat ID not set on Vercel; skipping alert.");
    return false;
  }
  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
      }),
    });
    return res.ok;
  } catch (err) {
    console.error("Failed to send Telegram alert from health check:", err);
    return false;
  }
}

export async function GET(request) {
  // 1. Verify CRON_SECRET if set
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
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

    let isDegraded = false;
    const failureReasons = [];

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

    // Check GitHub repo inactivity (GitHub Actions pauses scheduled runs after 60 days without commits)
    let commitDaysOld = null;
    let commitWarning = null;
    try {
      const repo = process.env.GITHUB_REPO || "dipesh4036/swing";
      const ghHeaders = {
        "User-Agent": "MarketBreadth-HealthCheck",
        Accept: "application/vnd.github+json",
      };
      if (process.env.GITHUB_TOKEN) {
        ghHeaders["Authorization"] = `Bearer ${process.env.GITHUB_TOKEN}`;
      }
      const ghRes = await fetch(`https://api.github.com/repos/${repo}/commits/main`, {
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
      }
    } catch (ghErr) {
      console.warn("Could not check commit inactivity via GitHub API:", ghErr.message);
    }

    let alertSent = false;
    // 4. Send Telegram alert at most once per calendar day
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
        const alertMsg = `⚠️ *Market Breadth Pipeline Health Alert*\n\n${failureReasons.map((r) => `• ${r}`).join("\n\n")}`;
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

    return NextResponse.json({
      status: isDegraded ? "degraded" : "healthy",
      latestBreadthDate: latestDate,
      daysSinceLastBreadth: daysOld,
      daysSinceLastCommit: commitDaysOld,
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
    });
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

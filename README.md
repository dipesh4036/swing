# 📊 Market Breadth Dashboard

An institutional-grade, real-time Market Breadth and Internals analytics platform for Indian Equities (NSE/BSE). Built with Next.js (App Router), Recharts, Tailwind CSS, and a specialized financial design system.

---

## ✨ Features

- **Market Read:** Real-time health metrics including Advances vs Declines, % above 20 EMA / 50 SMA / 200 SMA, and current market regime.
- **Stage Analysis:** Weinstein Stage distribution (Stage 1 Basing, Stage 2 Uptrend, Stage 3 Topping, Stage 4 Downtrend).
- **Market Participation & Stage Comparison:** Interactive multi-timeframe curves (1M / 3M / 1Y) with customizable universe filtering (Liquid 1000, Nifty 500, Nifty 200, Nifty 100).
- **Institutional Flows:** Daily and monthly net FII/DII cash flows across recent trading sessions.
- **Market Internals (6 Granular Analytics Cards):**
  1. *New Highs − Lows* (20D / 52W dynamic toggle)
  2. *Advance / Decline* (20D / 40D / Cumulative A-D Line toggle)
  3. *4% Movers* (Daily / 5D ratio / 10D ratio momentum toggle)
  4. *Large vs Mid vs Small* (1M / 3M / YTD comparative returns)
  5. *Breakouts − Breakdowns* (Daily / 5D net / Cumulative breakout pace)
  6. *Participation History* (20 EMA / 50 SMA / 200 SMA curve highlight)
- **Benchmark Indices Row:** Sparklines and returns for 7 key benchmark indices (Nifty 50, Nifty 500, Midcap 150, Smallcap 250, India VIX, Brent Crude, USD/INR).

---

## 🛠️ Tech Stack

- **Framework:** Next.js 15 (App Router, JavaScript/React 19)
- **Charts:** Recharts
- **Icons:** Lucide React
- **Styling:** Tailwind CSS + Custom Institutional Design System Tokens

---

## 🚀 Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Development Server
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the dashboard.

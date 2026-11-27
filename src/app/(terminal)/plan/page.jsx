"use client";

import React, { Suspense } from "react";
import { RefreshCw } from "lucide-react";
import DailyPlanView from "@/components/plan/DailyPlanView";

export default function PlanPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3">
          <RefreshCw className="w-6 h-6 animate-spin text-primary" />
          <span className="text-sm text-text-secondary">Loading Daily Plan...</span>
        </div>
      }
    >
      <DailyPlanView />
    </Suspense>
  );
}

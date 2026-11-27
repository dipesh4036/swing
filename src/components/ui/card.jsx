"use client";

import React from "react";
import { Info } from "lucide-react";

export function BaseCard({
  children,
  className = "",
  padding = "p-4",
  border = "border border-border",
  bg = "bg-surface",
  rounded = "rounded-lg",
  ...props
}) {
  return (
    <div
      className={`${bg} ${border} ${rounded} ${padding} transition-colors duration-150 ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

export function SectionCard({
  title,
  subtitle,
  action,
  info,
  children,
  className = "",
  headerBorder = true,
  ...props
}) {
  return (
    <BaseCard className={className} padding="p-0" {...props}>
      {(title || action) && (
        <div
          className={`flex items-center justify-between px-4 py-3 ${
            headerBorder ? "border-b border-border" : ""
          }`}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <h3 className="text-[13px] font-semibold text-text tracking-tight truncate">
              {title}
            </h3>
            {info && (
              <span
                className="text-text-secondary hover:text-text-secondary cursor-pointer transition-colors"
                title={info}
              >
                <Info size={13} />
              </span>
            )}
            {subtitle && (
              <span className="text-xs text-text-secondary ml-1.5 hidden sm:inline truncate">
                {subtitle}
              </span>
            )}
          </div>
          {action && <div className="flex items-center gap-2 shrink-0">{action}</div>}
        </div>
      )}
      <div className="p-4">{children}</div>
    </BaseCard>
  );
}

export function ChartCard({
  title,
  subtitle,
  action,
  legend,
  info,
  children,
  className = "",
}) {
  return (
    <SectionCard
      title={title}
      subtitle={subtitle}
      action={action}
      info={info}
      className={className}
    >
      {legend && <div className="mb-3 flex items-center gap-4 text-xs text-text-secondary">{legend}</div>}
      <div className="w-full">{children}</div>
    </SectionCard>
  );
}

export function MetricCard({
  label,
  value,
  subvalue,
  trend, // { value: "+2.4%", isPositive: true }
  action,
  className = "",
}) {
  return (
    <BaseCard className={`flex flex-col justify-between ${className}`} padding="p-3.5">
      <div className="flex items-center justify-between text-xs text-text-secondary font-medium uppercase tracking-wider mb-1.5">
        <span>{label}</span>
        {action}
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[20px] font-bold text-text tabular-nums tracking-tight">
          {value}
        </span>
        {trend && (
          <span
            className={`text-xs font-semibold tabular-nums px-1.5 py-0.5 rounded-[4px] border ${
              trend.isPositive
                ? "bg-bullish-bg text-bullish border-bullish-border"
                : "bg-bearish-bg text-bearish border-bearish-border"
            }`}
          >
            {trend.value}
          </span>
        )}
      </div>
      {subvalue && (
        <div className="text-xs text-text-secondary mt-1 tabular-nums truncate">
          {subvalue}
        </div>
      )}
    </BaseCard>
  );
}

export function StatCard({ label, value, note, children, className = "" }) {
  return (
    <BaseCard className={`flex flex-col gap-1.5 ${className}`}>
      <span className="text-xs font-medium uppercase tracking-wider text-text-secondary">
        {label}
      </span>
      <div className="text-[20px] font-bold text-text tabular-nums">{value}</div>
      {note && <div className="text-xs text-text-secondary">{note}</div>}
      {children}
    </BaseCard>
  );
}

export function InformationCard({ title, message, tone = "info", className = "" }) {
  const tones = {
    info: "bg-primary-subtle border-accent-border text-primary",
    warning: "bg-warning-bg border-warning/30 text-warning",
    success: "bg-bullish-bg border-bullish-border text-bullish",
    error: "bg-bearish-bg border-bearish-border text-bearish",
  }[tone] || "bg-primary-subtle border-accent-border text-primary";

  return (
    <div className={`p-3.5 border rounded-lg text-xs leading-relaxed ${tones} ${className}`}>
      {title && <div className="font-semibold mb-1">{title}</div>}
      <div>{message}</div>
    </div>
  );
}

export default BaseCard;


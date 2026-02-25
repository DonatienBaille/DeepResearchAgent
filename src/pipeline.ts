import cron from "node-cron";

/**
 * Pipeline Status Tracking Module
 * Shared state for pipeline run status, decoupled from index.ts to avoid circular imports
 */

export interface PipelineRunInfo {
  startedAt: string;
  completedAt: string;
  durationMs: number;
  topicsProcessed: number;
  reportsGenerated: number;
  status: "success" | "partial" | "error";
  error?: string;
}

export interface PipelineStatus {
  isRunning: boolean;
  lastRun: PipelineRunInfo | null;
  nextRun: string | null;
  cronSchedule: string;
  cronEnabled: boolean;
}

// ============= Internal State =============

let pipelineRunning = false;
let lastRunInfo: PipelineRunInfo | null = null;
let cronSchedule = "";
let cronEnabled = false;

// ============= State Accessors =============

export function isPipelineRunning(): boolean {
  return pipelineRunning;
}

export function setPipelineRunning(running: boolean): void {
  pipelineRunning = running;
}

export function getLastRunInfo(): PipelineRunInfo | null {
  return lastRunInfo;
}

export function setLastRunInfo(info: PipelineRunInfo): void {
  lastRunInfo = info;
}

export function setCronConfig(schedule: string, enabled: boolean): void {
  cronSchedule = schedule;
  cronEnabled = enabled;
}

// ============= Cron Helpers =============

/**
 * Check if a value matches a single cron field expression
 */
function matchCronField(
  field: string,
  value: number,
  _min: number,
  _max: number,
): boolean {
  if (field === "*") return true;

  for (const part of field.split(",")) {
    const [range, stepStr] = part.split("/");
    const step = stepStr ? parseInt(stepStr, 10) : 1;

    if (range === "*") {
      if ((value - _min) % step === 0) return true;
      continue;
    }

    if (range.includes("-")) {
      const [from, to] = range.split("-").map(Number);
      if (value >= from && value <= to && (value - from) % step === 0)
        return true;
      continue;
    }

    if (parseInt(range, 10) === value) return true;
  }
  return false;
}

/**
 * Get the next scheduled run date from cron expression
 */
function getNextCronDate(schedule: string): string | null {
  try {
    if (!cron.validate(schedule)) return null;
    const parts = schedule.trim().split(/\s+/);
    if (parts.length < 5) return null;

    const now = new Date();
    // Iterate minute by minute for up to 48h
    for (let i = 1; i <= 2880; i++) {
      const candidate = new Date(now.getTime() + i * 60_000);
      const min = candidate.getMinutes();
      const hour = candidate.getHours();
      const dom = candidate.getDate();
      const month = candidate.getMonth() + 1;
      const dow = candidate.getDay();

      if (
        matchCronField(parts[0], min, 0, 59) &&
        matchCronField(parts[1], hour, 0, 23) &&
        matchCronField(parts[2], dom, 1, 31) &&
        matchCronField(parts[3], month, 1, 12) &&
        matchCronField(parts[4], dow, 0, 7)
      ) {
        return candidate.toISOString();
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ============= Public API =============

/**
 * Get current pipeline status
 */
export function getPipelineStatus(): PipelineStatus {
  return {
    isRunning: pipelineRunning,
    lastRun: lastRunInfo,
    nextRun: cronEnabled ? getNextCronDate(cronSchedule) : null,
    cronSchedule,
    cronEnabled,
  };
}

// ============= Manual Run Trigger =============

/** Registered research cycle function (set by index.ts at startup) */
let registeredRunFn: (() => Promise<void>) | null = null;

/**
 * Register the executeResearchCycle function from index.ts
 * This avoids circular imports between api.ts → index.ts → web.ts → api.ts
 */
export function registerRunFunction(fn: () => Promise<void>): void {
  registeredRunFn = fn;
}

/**
 * Manually trigger a pipeline run
 * Returns immediately with status, runs in background
 */
export async function triggerManualRun(): Promise<{
  started: boolean;
  reason?: string;
}> {
  if (pipelineRunning) {
    return { started: false, reason: "Pipeline is already running" };
  }

  if (!registeredRunFn) {
    return { started: false, reason: "Pipeline not initialized" };
  }

  // Fire and forget — runs in background
  registeredRunFn().catch((error) => {
    console.error("[Pipeline] Manual run failed:", error);
  });

  return { started: true };
}

import { describe, it, expect, beforeEach } from "bun:test";
import {
  getPipelineStatus,
  triggerManualRun,
  isPipelineRunning,
  setPipelineRunning,
  setLastRunInfo,
  setCronConfig,
  registerRunFunction,
} from "../../src/pipeline.js";
import type { PipelineStatus, PipelineRunInfo } from "../../src/pipeline.js";

/**
 * Unit Tests for Pipeline Status Module
 * Tests status tracking, cron schedule parsing, and manual run triggering
 */

// Reset pipeline state before each test
beforeEach(() => {
  setPipelineRunning(false);
  setCronConfig("", false);
  registerRunFunction(null as any);
  // Reset lastRun by setting a known state
});

describe("Pipeline - Status", () => {
  it("should return default idle status", () => {
    const status = getPipelineStatus();

    expect(status.isRunning).toBe(false);
    expect(status.cronSchedule).toBe("");
    expect(status.cronEnabled).toBe(false);
    expect(status.nextRun).toBeNull();
  });

  it("should reflect running state", () => {
    setPipelineRunning(true);
    expect(isPipelineRunning()).toBe(true);
    expect(getPipelineStatus().isRunning).toBe(true);

    setPipelineRunning(false);
    expect(isPipelineRunning()).toBe(false);
    expect(getPipelineStatus().isRunning).toBe(false);
  });

  it("should store and return last run info", () => {
    const runInfo: PipelineRunInfo = {
      startedAt: "2026-02-25T09:00:00.000Z",
      completedAt: "2026-02-25T09:01:30.000Z",
      durationMs: 90000,
      topicsProcessed: 3,
      reportsGenerated: 3,
      status: "success",
    };
    setLastRunInfo(runInfo);

    const status = getPipelineStatus();
    expect(status.lastRun).toEqual(runInfo);
    expect(status.lastRun?.status).toBe("success");
    expect(status.lastRun?.topicsProcessed).toBe(3);
  });

  it("should store error run info", () => {
    const runInfo: PipelineRunInfo = {
      startedAt: "2026-02-25T09:00:00.000Z",
      completedAt: "2026-02-25T09:00:05.000Z",
      durationMs: 5000,
      topicsProcessed: 0,
      reportsGenerated: 0,
      status: "error",
      error: "API timeout",
    };
    setLastRunInfo(runInfo);

    const status = getPipelineStatus();
    expect(status.lastRun?.status).toBe("error");
    expect(status.lastRun?.error).toBe("API timeout");
  });

  it("should reflect cron configuration", () => {
    setCronConfig("0 9 * * *", true);

    const status = getPipelineStatus();
    expect(status.cronSchedule).toBe("0 9 * * *");
    expect(status.cronEnabled).toBe(true);
  });

  it("should compute next run for simple cron schedule", () => {
    setCronConfig("0 9 * * *", true);
    const status = getPipelineStatus();

    // nextRun should be a valid ISO date string
    expect(status.nextRun).toBeTruthy();
    expect(new Date(status.nextRun!).getTime()).toBeGreaterThan(Date.now());
    // Should be at hour 9, minute 0
    const next = new Date(status.nextRun!);
    expect(next.getHours()).toBe(9);
    expect(next.getMinutes()).toBe(0);
  });

  it("should return null nextRun when cron is disabled", () => {
    setCronConfig("0 9 * * *", false);
    const status = getPipelineStatus();
    expect(status.nextRun).toBeNull();
  });
});

describe("Pipeline - Manual Trigger", () => {
  it("should start when not running and function is registered", async () => {
    let called = false;
    registerRunFunction(async () => {
      called = true;
    });

    const result = await triggerManualRun();
    expect(result.started).toBe(true);

    // Give the async fire-and-forget a tick to execute
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(called).toBe(true);
  });

  it("should reject when pipeline is already running", async () => {
    registerRunFunction(async () => {});
    setPipelineRunning(true);

    const result = await triggerManualRun();
    expect(result.started).toBe(false);
    expect(result.reason).toContain("already running");
  });

  it("should reject when no run function is registered", async () => {
    const result = await triggerManualRun();
    expect(result.started).toBe(false);
    expect(result.reason).toContain("not initialized");
  });
});

describe("Pipeline - Cron Next Run Computation", () => {
  it("should compute next run for */5 schedule", () => {
    setCronConfig("*/5 * * * *", true);
    const status = getPipelineStatus();

    expect(status.nextRun).toBeTruthy();
    const next = new Date(status.nextRun!);
    expect(next.getMinutes() % 5).toBe(0);
  });

  it("should compute next run with specific hour and minute", () => {
    setCronConfig("30 14 * * *", true);
    const status = getPipelineStatus();

    expect(status.nextRun).toBeTruthy();
    const next = new Date(status.nextRun!);
    expect(next.getHours()).toBe(14);
    expect(next.getMinutes()).toBe(30);
  });

  it("should handle range-based cron expressions", () => {
    // Every hour from 8 to 18
    setCronConfig("0 8-18 * * *", true);
    const status = getPipelineStatus();

    expect(status.nextRun).toBeTruthy();
    const next = new Date(status.nextRun!);
    expect(next.getHours()).toBeGreaterThanOrEqual(8);
    expect(next.getHours()).toBeLessThanOrEqual(18);
    expect(next.getMinutes()).toBe(0);
  });
});

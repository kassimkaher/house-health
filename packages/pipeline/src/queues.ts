/** BullMQ queue names and deterministic job-id helpers (prefix hh:). */
export const QUEUE_PREFIX = "hh";

export const QUEUES = {
  imports: "imports",
  catalog: "catalog",
  emails: "emails",
  reminders: "reminders",
  maintenance: "maintenance",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/**
 * Deterministic job ids — retries of the same work are BullMQ no-ops.
 *
 * NOT colon-delimited: BullMQ reserves `:` in custom job ids for its own
 * legacy repeatable-job format (rejects any id whose `:`-split doesn't
 * have exactly 3 parts — see bullmq's Job.validateOptions — and a code
 * comment there says even that 3-part exception is going away in a future
 * breaking change). `reminderDispatch` below used to coincidentally have
 * 3 parts and pass; `importRun`/`importRetry`/`releaseBuild` didn't and
 * threw "Custom Id cannot contain :" the moment a real BullMQ instance
 * was hit — never caught in tests because no integration test exercises
 * the actual HTTP import endpoint's queue.add() call (only
 * ImportRunner/ReleaseService directly). Use `.` throughout instead.
 */
export const jobIds = {
  importRun: (importJobId: string) => `import.${importJobId}`,
  importRetry: (importJobId: string, attempt: number) => `import.${importJobId}.retry.${attempt}`,
  releaseBuild: (version: string) => `release-build.${version}`,
  reminderDispatch: (reminderId: string, epochMs: number) => `reminder.${reminderId}.${epochMs}`,
};

export interface ImportRunJobData {
  importJobId: string;
}

export interface ReleaseBuildJobData {
  version: string;
  ownerId: string;
  notes?: string;
}

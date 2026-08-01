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

/** Deterministic job ids — retries of the same work are BullMQ no-ops. */
export const jobIds = {
  importRun: (importJobId: string) => `import:${importJobId}`,
  importRetry: (importJobId: string, attempt: number) => `import:${importJobId}:retry:${attempt}`,
  releaseBuild: (version: string) => `release-build:${version}`,
  reminderDispatch: (reminderId: string, epochMs: number) => `reminder:${reminderId}:${epochMs}`,
};

export interface ImportRunJobData {
  importJobId: string;
}

export interface ReleaseBuildJobData {
  version: string;
  ownerId: string;
  notes?: string;
}

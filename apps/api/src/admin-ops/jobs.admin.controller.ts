import { Controller, Get, Inject } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { RequirePermission } from "@hh/auth";
import type { Queue } from "bullmq";
import { CATALOG_QUEUE, IMPORTS_QUEUE, REMINDERS_QUEUE } from "../infra/queues.module";

interface QueueSummary {
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  completed: number;
  failed: number;
}

@ApiTags("admin/jobs")
@ApiBearerAuth()
@Controller("admin/jobs")
export class JobsAdminController {
  constructor(
    @Inject(IMPORTS_QUEUE) private readonly importsQueue: Queue,
    @Inject(CATALOG_QUEUE) private readonly catalogQueue: Queue,
    @Inject(REMINDERS_QUEUE) private readonly remindersQueue: Queue,
  ) {}

  @Get("summary")
  @RequirePermission("jobs.view")
  @ApiOperation({ summary: "Queue depths across imports/catalog/reminders (BullMQ job counts)" })
  async summary(): Promise<{ queues: QueueSummary[] }> {
    const queues = [
      { name: "imports", queue: this.importsQueue },
      { name: "catalog", queue: this.catalogQueue },
      { name: "reminders", queue: this.remindersQueue },
    ];
    const summaries = await Promise.all(
      queues.map(async ({ name, queue }) => {
        const counts = await queue.getJobCounts("waiting", "active", "delayed", "completed", "failed");
        return {
          name,
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          delayed: counts.delayed ?? 0,
          completed: counts.completed ?? 0,
          failed: counts.failed ?? 0,
        };
      }),
    );
    return { queues: summaries };
  }

  @Get("failed")
  @RequirePermission("jobs.view")
  @ApiOperation({ summary: "Recent failed jobs across all monitored queues" })
  async failed(): Promise<Array<{ queue: string; id: string | undefined; name: string; failedReason: string; timestamp: number }>> {
    const queues = [
      { name: "imports", queue: this.importsQueue },
      { name: "catalog", queue: this.catalogQueue },
      { name: "reminders", queue: this.remindersQueue },
    ];
    const results = await Promise.all(
      queues.map(async ({ name, queue }) => {
        const jobs = await queue.getFailed(0, 20);
        return jobs.map((job) => ({
          queue: name,
          id: job.id,
          name: job.name,
          failedReason: job.failedReason ?? "unknown",
          timestamp: job.timestamp,
        }));
      }),
    );
    return results.flat().sort((a, b) => b.timestamp - a.timestamp);
  }
}

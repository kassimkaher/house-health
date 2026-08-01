import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser, type RequestUser } from "@hh/auth";
import {
  ERROR_CODES,
  ZodValidationPipe,
  upsertReminderSchema,
  type UpsertReminderDto,
} from "@hh/contracts";
import type { Prisma, Reminder, ReminderDelivery } from "@hh/database";
import { computeNextFireAt } from "@hh/domain";
import { PrismaService } from "../infra/prisma.service";

@Injectable()
export class RemindersService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private async timezone(userId: string): Promise<string> {
    const profile = await this.prisma.userProfile.findUnique({ where: { userId } });
    return profile?.timezone ?? "Asia/Baghdad";
  }

  private schedule(dto: UpsertReminderDto, timezone: string, after: Date): Date | null {
    return computeNextFireAt(
      {
        timeLocal: dto.timeLocal,
        daysOfWeek: dto.daysOfWeek,
        oneTimeOn: dto.oneTimeOn ?? null,
        timezone,
      },
      after,
    );
  }

  list(userId: string): Promise<Reminder[]> {
    return this.prisma.reminder.findMany({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: "asc" },
    });
  }

  async create(userId: string, dto: UpsertReminderDto): Promise<Reminder> {
    const timezone = await this.timezone(userId);
    return this.prisma.reminder.create({
      data: {
        userId,
        type: dto.type,
        mealSlot: dto.mealSlot ?? null,
        mealGroupId: dto.mealGroupId ?? null,
        customText: dto.customText ?? null,
        timeLocal: dto.timeLocal,
        daysOfWeek: dto.daysOfWeek,
        oneTimeOn: dto.oneTimeOn ? new Date(`${dto.oneTimeOn}T00:00:00Z`) : null,
        isEnabled: dto.isEnabled,
        nextFireAt: dto.isEnabled ? this.schedule(dto, timezone, new Date()) : null,
      },
    });
  }

  async update(userId: string, id: string, dto: UpsertReminderDto): Promise<Reminder> {
    const existing = await this.prisma.reminder.findFirst({ where: { id, userId, deletedAt: null } });
    if (!existing) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND });
    const timezone = await this.timezone(userId);
    return this.prisma.reminder.update({
      where: { id },
      data: {
        type: dto.type,
        mealSlot: dto.mealSlot ?? null,
        mealGroupId: dto.mealGroupId ?? null,
        customText: dto.customText ?? null,
        timeLocal: dto.timeLocal,
        daysOfWeek: dto.daysOfWeek,
        oneTimeOn: dto.oneTimeOn ? new Date(`${dto.oneTimeOn}T00:00:00Z`) : null,
        isEnabled: dto.isEnabled,
        nextFireAt: dto.isEnabled ? this.schedule(dto, timezone, new Date()) : null,
      },
    });
  }

  async remove(userId: string, id: string): Promise<void> {
    const updated = await this.prisma.reminder.updateMany({
      where: { id, userId, deletedAt: null },
      data: { deletedAt: new Date(), isEnabled: false, nextFireAt: null },
    });
    if (updated.count === 0) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND });
  }

  async deliveries(userId: string, id: string): Promise<ReminderDelivery[]> {
    const reminder = await this.prisma.reminder.findFirst({ where: { id, userId } });
    if (!reminder) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND });
    return this.prisma.reminderDelivery.findMany({
      where: { reminderId: id },
      orderBy: { scheduledFor: "desc" },
      take: 50,
    });
  }
}

@ApiTags("reminders")
@ApiBearerAuth()
@Controller("reminders")
export class RemindersController {
  constructor(@Inject(RemindersService) private readonly reminders: RemindersService) {}

  @Get()
  list(@CurrentUser() user: RequestUser): Promise<Reminder[]> {
    return this.reminders.list(user.userId);
  }

  @Post()
  @ApiOperation({ summary: "Create a reminder; next occurrence computed via profile timezone" })
  create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(upsertReminderSchema)) dto: UpsertReminderDto,
  ): Promise<Reminder> {
    return this.reminders.create(user.userId, dto);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: RequestUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(upsertReminderSchema)) dto: UpsertReminderDto,
  ): Promise<Reminder> {
    return this.reminders.update(user.userId, id, dto);
  }

  @Get(":id/deliveries")
  @ApiOperation({ summary: "Delivery log for a reminder" })
  deliveries(@CurrentUser() user: RequestUser, @Param("id", ParseUUIDPipe) id: string): Promise<ReminderDelivery[]> {
    return this.reminders.deliveries(user.userId, id);
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@CurrentUser() user: RequestUser, @Param("id", ParseUUIDPipe) id: string): Promise<void> {
    await this.reminders.remove(user.userId, id);
  }
}

@Module({
  controllers: [RemindersController],
  providers: [RemindersService],
})
export class RemindersModule {}

export type { Prisma };

import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser, type RequestUser } from "@hh/auth";
import {
  ZodValidationPipe,
  listWeightQuerySchema,
  updateProfileSchema,
  updateWeightSchema,
  upsertWeightSchema,
  type ListWeightQuery,
  type ProfileView,
  type UpdateProfileDto,
  type UpdateWeightDto,
  type UpsertWeightDto,
  type WeightEntryView,
  type WeightTrendView,
} from "@hh/contracts";
import { ProfileService } from "./profile.service";

@ApiTags("profile")
@ApiBearerAuth()
@Controller("me")
export class ProfileController {
  constructor(@Inject(ProfileService) private readonly profiles: ProfileService) {}

  @Get("profile")
  @ApiOperation({ summary: "Health/activity profile of the current user" })
  getProfile(@CurrentUser() user: RequestUser): Promise<ProfileView> {
    return this.profiles.getProfile(user.userId);
  }

  @Patch("profile")
  @ApiOperation({ summary: "Update profile fields (partial)" })
  updateProfile(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(updateProfileSchema)) dto: UpdateProfileDto,
  ): Promise<ProfileView> {
    return this.profiles.updateProfile(user.userId, dto);
  }

  @Get("weight")
  @ApiOperation({ summary: "Weight history (newest first)" })
  listWeight(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(listWeightQuerySchema)) query: ListWeightQuery,
  ): Promise<WeightEntryView[]> {
    return this.profiles.listWeight(user.userId, query);
  }

  @Get("weight/trend")
  @ApiOperation({ summary: "Weight trend vs target" })
  weightTrend(@CurrentUser() user: RequestUser): Promise<WeightTrendView> {
    return this.profiles.weightTrend(user.userId);
  }

  @Post("weight")
  @HttpCode(200)
  @ApiOperation({ summary: "Add or replace the weigh-in for a date" })
  upsertWeight(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(upsertWeightSchema)) dto: UpsertWeightDto,
  ): Promise<WeightEntryView> {
    return this.profiles.upsertWeight(user.userId, dto);
  }

  @Patch("weight/:id")
  @ApiOperation({ summary: "Edit a weigh-in" })
  updateWeight(
    @CurrentUser() user: RequestUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateWeightSchema)) dto: UpdateWeightDto,
  ): Promise<WeightEntryView> {
    return this.profiles.updateWeight(user.userId, id, dto);
  }

  @Delete("weight/:id")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete a weigh-in" })
  async deleteWeight(@CurrentUser() user: RequestUser, @Param("id", ParseUUIDPipe) id: string): Promise<void> {
    await this.profiles.deleteWeight(user.userId, id);
  }
}

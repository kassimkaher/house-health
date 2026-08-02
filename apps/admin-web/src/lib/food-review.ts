import type { ReviewStatus } from "@/lib/types";

/**
 * Client-side mirror of the legal review-state transitions enforced in
 * apps/api/src/catalog/foods.service.ts — used only to decide which
 * transition buttons to show; the server re-validates on every request.
 */
export const REVIEW_TRANSITIONS: Record<ReviewStatus, ReviewStatus[]> = {
  imported: ["normalized", "needs_review", "archived"],
  normalized: ["needs_review", "archived"],
  needs_review: ["verified", "rejected", "archived"],
  verified: ["needs_review", "archived"],
  rejected: ["needs_review", "archived"],
  archived: ["needs_review"],
};

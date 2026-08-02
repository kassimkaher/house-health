import { MockMealPlanProvider } from "./ai";

describe("MockMealPlanProvider", () => {
  it("is disabled and rejects any call — proves the seam without an AI dependency", async () => {
    const provider = new MockMealPlanProvider();
    expect(provider.isEnabled).toBe(false);
    await expect(
      provider.generatePlan({
        userId: "u1",
        days: 1,
        constraints: { targetKcal: 2000, dietaryPrefs: [], allergies: [], excludedFoodIds: [], mealsPerDay: 3, locale: "ar" },
        candidates: [],
        likedSuggestionIds: [],
        rejectedSuggestionIds: [],
      }),
    ).rejects.toThrow(/not enabled/);
    await expect(
      provider.revisePlan({
        plan: { status: "draft", days: [], providerName: "mock", explanation: [] },
        instructionsText: "less rice",
        rejectedSuggestionIds: [],
      }),
    ).rejects.toThrow(/not enabled/);
  });
});

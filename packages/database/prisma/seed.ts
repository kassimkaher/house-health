/**
 * Idempotent seed: nutrient definitions, food categories, calculation policy,
 * data providers. Dev accounts are created only when SEED_DEV_ACCOUNTS=1.
 * Run: pnpm --filter @hh/database seed
 */
import { hashPassword } from "@hh/auth";
import { prisma } from "../src/client";

const CORE_NUTRIENTS = [
  { key: "energy_kcal", nameAr: "الطاقة (سعرة حرارية)", nameEn: "Energy (kcal)", unit: "kcal", displayOrder: 1, precision: 0 },
  { key: "energy_kj", nameAr: "الطاقة (كيلوجول)", nameEn: "Energy (kJ)", unit: "kJ", displayOrder: 2, precision: 0 },
  { key: "protein_g", nameAr: "البروتين", nameEn: "Protein", unit: "g", displayOrder: 3, precision: 1 },
  { key: "carbs_g", nameAr: "الكربوهيدرات", nameEn: "Carbohydrate", unit: "g", displayOrder: 4, precision: 1 },
  { key: "fat_g", nameAr: "الدهون الكلية", nameEn: "Total fat", unit: "g", displayOrder: 5, precision: 1 },
  { key: "sat_fat_g", nameAr: "الدهون المشبعة", nameEn: "Saturated fat", unit: "g", displayOrder: 6, precision: 1 },
  { key: "fiber_g", nameAr: "الألياف", nameEn: "Fiber", unit: "g", displayOrder: 7, precision: 1 },
  { key: "sugars_g", nameAr: "السكريات الكلية", nameEn: "Total sugars", unit: "g", displayOrder: 8, precision: 1 },
  { key: "sodium_mg", nameAr: "الصوديوم", nameEn: "Sodium", unit: "mg", displayOrder: 9, precision: 0 },
  { key: "cholesterol_mg", nameAr: "الكوليسترول", nameEn: "Cholesterol", unit: "mg", displayOrder: 10, precision: 0 },
] as const;

const CATEGORIES: Array<{ slug: string; nameAr: string; nameEn: string; children?: Array<{ slug: string; nameAr: string; nameEn: string }> }> = [
  {
    slug: "grains-bread", nameAr: "الحبوب والخبز", nameEn: "Grains & bread",
    children: [
      { slug: "bread", nameAr: "الخبز", nameEn: "Bread" },
      { slug: "rice-pasta", nameAr: "الرز والمعكرونة", nameEn: "Rice & pasta" },
      { slug: "breakfast-cereals", nameAr: "حبوب الفطور", nameEn: "Breakfast cereals" },
    ],
  },
  {
    slug: "dairy", nameAr: "الألبان ومشتقاتها", nameEn: "Dairy",
    children: [
      { slug: "milk", nameAr: "الحليب", nameEn: "Milk" },
      { slug: "cheese", nameAr: "الجبن", nameEn: "Cheese" },
      { slug: "yogurt", nameAr: "اللبن والزبادي", nameEn: "Yogurt" },
    ],
  },
  {
    slug: "meat-poultry", nameAr: "اللحوم والدواجن", nameEn: "Meat & poultry",
    children: [
      { slug: "beef-lamb", nameAr: "لحم البقر والغنم", nameEn: "Beef & lamb" },
      { slug: "chicken", nameAr: "الدجاج", nameEn: "Chicken" },
    ],
  },
  { slug: "fish-seafood", nameAr: "الأسماك والمأكولات البحرية", nameEn: "Fish & seafood" },
  { slug: "eggs", nameAr: "البيض", nameEn: "Eggs" },
  { slug: "vegetables", nameAr: "الخضروات", nameEn: "Vegetables" },
  { slug: "fruits", nameAr: "الفواكه", nameEn: "Fruits" },
  { slug: "legumes", nameAr: "البقوليات", nameEn: "Legumes" },
  { slug: "nuts-seeds", nameAr: "المكسرات والبذور", nameEn: "Nuts & seeds" },
  { slug: "oils-fats", nameAr: "الزيوت والدهون", nameEn: "Oils & fats" },
  { slug: "beverages", nameAr: "المشروبات", nameEn: "Beverages" },
  { slug: "sweets-desserts", nameAr: "الحلويات", nameEn: "Sweets & desserts" },
  {
    slug: "prepared-dishes", nameAr: "الأطباق الجاهزة", nameEn: "Prepared dishes",
    children: [
      { slug: "iraqi-dishes", nameAr: "أكلات عراقية", nameEn: "Iraqi dishes" },
      { slug: "fast-food", nameAr: "الوجبات السريعة", nameEn: "Fast food" },
    ],
  },
  { slug: "snacks", nameAr: "الوجبات الخفيفة", nameEn: "Snacks" },
];

/**
 * Calculation policy v1 — Mifflin–St Jeor. All assumptions live here so the
 * engine can surface them in explanations; admins version this via new rows.
 */
const CALC_POLICY_V1 = {
  equation: "mifflin_st_jeor",
  activityMultipliers: {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    active: 1.725,
    very_active: 1.9,
  },
  // 1 kg body mass ≈ 7700 kcal; goal rate (kg/week) → daily delta.
  kcalPerKgBodyMass: 7700,
  guardrails: {
    maxDailyDeficitKcal: 1000,
    maxDailySurplusKcal: 500,
    minCaloriesFemale: 1200,
    minCaloriesMale: 1500,
    minAgeYears: 18,
    maxAgeYears: 100,
    goalRateMaxKgPerWeek: 1.0,
  },
  macroDefaults: { proteinPct: 30, carbsPct: 40, fatPct: 30 },
  rounding: { calories: 10, macrosG: 1 },
  disclaimers: ["estimates_not_medical_advice"],
};

async function main(): Promise<void> {
  for (const n of CORE_NUTRIENTS) {
    await prisma.nutrientDefinition.upsert({
      where: { key: n.key },
      update: { nameAr: n.nameAr, nameEn: n.nameEn, unit: n.unit, displayOrder: n.displayOrder, precision: n.precision, isCore: true },
      create: { ...n, isCore: true },
    });
  }
  console.warn(`Seeded ${CORE_NUTRIENTS.length} nutrient definitions`);

  for (const [i, cat] of CATEGORIES.entries()) {
    const parent = await prisma.foodCategory.upsert({
      where: { slug: cat.slug },
      update: { nameAr: cat.nameAr, nameEn: cat.nameEn, sortOrder: i },
      create: { slug: cat.slug, nameAr: cat.nameAr, nameEn: cat.nameEn, sortOrder: i },
    });
    for (const [j, child] of (cat.children ?? []).entries()) {
      await prisma.foodCategory.upsert({
        where: { slug: child.slug },
        update: { nameAr: child.nameAr, nameEn: child.nameEn, parentId: parent.id, sortOrder: j },
        create: { slug: child.slug, nameAr: child.nameAr, nameEn: child.nameEn, parentId: parent.id, sortOrder: j },
      });
    }
  }
  console.warn(`Seeded ${CATEGORIES.length} top-level categories`);

  await prisma.calculationPolicy.upsert({
    where: { key_version: { key: "mifflin_st_jeor", version: 1 } },
    update: { config: CALC_POLICY_V1, isActive: true },
    create: { key: "mifflin_st_jeor", version: 1, isActive: true, config: CALC_POLICY_V1, notes: "Initial policy. Mifflin–St Jeor with standard activity multipliers." },
  });
  console.warn("Seeded calculation policy mifflin_st_jeor v1");

  const providers = [
    { key: "iq_manual", name: "Internal Iraqi dataset (manually curated)", licenseName: "internal", attributionRequired: false },
    { key: "usda_fdc", name: "USDA FoodData Central", licenseName: "CC0 1.0", licenseUrl: "https://fdc.nal.usda.gov/", attributionRequired: false },
    { key: "openfoodfacts", name: "Open Food Facts", licenseName: "ODbL 1.0", licenseUrl: "https://world.openfoodfacts.org/", attributionRequired: true },
  ];
  for (const p of providers) {
    await prisma.dataProvider.upsert({ where: { key: p.key }, update: p, create: p });
  }
  console.warn(`Seeded ${providers.length} data providers`);

  if (process.env.SEED_DEV_ACCOUNTS === "1") {
    const accounts = [
      { email: "dev-superadmin@local.test", roles: ["super_admin" as const], password: "Dev_SuperAdmin_1!" },
      { email: "dev-datamanager@local.test", roles: ["data_manager" as const], password: "Dev_DataManager_1!" },
      { email: "dev-reviewer@local.test", roles: ["nutrition_reviewer" as const], password: "Dev_Reviewer_1!" },
      { email: "dev-support@local.test", roles: ["support_admin" as const], password: "Dev_Support_1!" },
      { email: "dev-user@local.test", roles: ["user" as const], password: "Dev_User_1!" },
    ];
    for (const a of accounts) {
      const passwordHash = await hashPassword(a.password);
      const existing = await prisma.user.findFirst({ where: { email: a.email, deletedAt: null } });
      if (existing) {
        await prisma.user.update({ where: { id: existing.id }, data: { roles: a.roles, passwordHash } });
      } else {
        const user = await prisma.user.create({
          data: {
            email: a.email,
            passwordHash,
            roles: a.roles,
            status: "active",
            emailVerifiedAt: new Date(),
          },
        });
        await prisma.userProfile.create({ data: { userId: user.id, displayName: a.email.split("@")[0] } });
      }
    }
    console.warn(`Seeded ${accounts.length} dev accounts (SEED_DEV_ACCOUNTS=1)`);
  }
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });

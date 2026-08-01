import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Shared flat ESLint config. Domain purity (packages/domain must not import
 * Nest/Prisma/infrastructure) is enforced via no-restricted-imports overrides
 * added per package.
 */
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["dist/**", ".next/**", "node_modules/**", "coverage/**"],
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
);

/** Restriction set for packages/domain — keep the core framework-free. */
export const domainPurityRules = {
  "no-restricted-imports": [
    "error",
    {
      patterns: [
        {
          group: ["@nestjs/*", "@prisma/*", "prisma", "bullmq", "ioredis", "next", "next/*"],
          message:
            "packages/domain is framework-free: depend on ports/interfaces, not infrastructure.",
        },
      ],
    },
  ],
};

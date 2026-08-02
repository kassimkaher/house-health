import { z } from "zod";

export const selfDeleteAccountSchema = z
  .object({
    password: z.string().min(1).max(128),
    confirm: z.literal(true),
  })
  .strict();
export type SelfDeleteAccountDto = z.infer<typeof selfDeleteAccountSchema>;

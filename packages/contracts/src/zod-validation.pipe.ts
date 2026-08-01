import { UnprocessableEntityException, type PipeTransform } from "@nestjs/common";
import { type ZodType } from "zod";
import { ERROR_CODES, type ValidationFieldError } from "./error-codes";

/**
 * Minimal Nest pipe validating a payload against a Zod schema. Used per-route:
 * `@Body(new ZodValidationPipe(loginSchema)) dto: LoginDto`. Invalid payloads
 * yield 422 with machine-readable field errors.
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const fields: ValidationFieldError[] = result.error.issues.map((issue) => ({
        path: issue.path.map(String).join("."),
        message: issue.message,
      }));
      throw new UnprocessableEntityException({
        code: ERROR_CODES.VALIDATION_FAILED,
        fields,
      });
    }
    return result.data;
  }
}

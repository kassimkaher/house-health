import { HttpException, HttpStatus } from "@nestjs/common";
import { ERROR_CODES } from "@hh/contracts";
import { ApiThrottlerGuard } from "./api-throttler.guard";

describe("ApiThrottlerGuard", () => {
  it("throws a 429 with the machine-readable rate_limited code", () => {
    const guard = Object.create(ApiThrottlerGuard.prototype) as ApiThrottlerGuard;
    const call = (
      guard as unknown as {
        throwThrottlingException: (ctx: unknown, detail: unknown) => Promise<void>;
      }
    ).throwThrottlingException.bind(guard);

    // The method is typed Promise<void> to match the base class's abstract
    // signature, but throws synchronously — assert the thrown value directly.
    let caught: unknown;
    try {
      void call({}, {});
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HttpException);
    expect(caught).toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
      response: { code: ERROR_CODES.RATE_LIMITED },
    });
  });
});

import { HttpException, HttpStatus, Injectable, type ExecutionContext } from "@nestjs/common";
import { ThrottlerGuard, type ThrottlerLimitDetail } from "@nestjs/throttler";
import { ERROR_CODES } from "@hh/contracts";

/** ThrottlerGuard with a machine-readable 429 body. */
@Injectable()
export class ApiThrottlerGuard extends ThrottlerGuard {
  protected override throwThrottlingException(
    _context: ExecutionContext,
    _throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    throw new HttpException({ code: ERROR_CODES.RATE_LIMITED }, HttpStatus.TOO_MANY_REQUESTS);
  }
}

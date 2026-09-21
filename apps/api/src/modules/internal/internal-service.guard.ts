import { timingSafeEqual } from "node:crypto";
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";

type InternalRequest = {
  headers?: {
    authorization?: string | string[];
  };
};

@Injectable()
export class InternalServiceGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.INTERNAL_WORKER_TOKEN?.trim();
    if (!expected) {
      throw new UnauthorizedException(
        "Internal service authentication is not configured."
      );
    }

    const request = context.switchToHttp().getRequest<InternalRequest>();
    const rawAuthorization = request.headers?.authorization;
    const authorization = Array.isArray(rawAuthorization)
      ? rawAuthorization[0]
      : rawAuthorization;

    if (!authorization?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Internal bearer token is required.");
    }

    const actual = authorization.slice("Bearer ".length).trim();
    const expectedBytes = Buffer.from(expected);
    const actualBytes = Buffer.from(actual);

    if (
      expectedBytes.length !== actualBytes.length ||
      !timingSafeEqual(expectedBytes, actualBytes)
    ) {
      throw new UnauthorizedException("Invalid internal bearer token.");
    }

    return true;
  }
}

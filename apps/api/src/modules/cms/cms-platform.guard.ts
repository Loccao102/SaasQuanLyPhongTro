import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";
import type { QueryResultRow } from "pg";
import { DatabaseService } from "../database/database.service.js";
import {
  assertTrustedBrowserOrigin,
  isUnsafeHttpMethod,
  readCsrfHeader,
  readSessionToken
} from "../identity/auth/auth-http.js";
import { AuthenticationService } from "../identity/auth/authentication.service.js";
import type { CmsRequest, PlatformPrincipal } from "./cms.types.js";
import { isPlatformRole } from "./domain/platform-access.js";

type PlatformOperatorRow = QueryResultRow & {
  user_id: string;
  role: string;
  operator_status: string;
  user_status: string;
};

@Injectable()
export class CmsPlatformGuard implements CanActivate {
  constructor(
    private readonly db: DatabaseService,
    private readonly authentication: AuthenticationService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<CmsRequest>();
    let userId = request.authenticatedUserId;
    const sessionToken = readSessionToken(request);

    if (!userId && sessionToken) {
      const session = await this.authentication.authenticateSession(sessionToken);
      if (!session) {
        throw new UnauthorizedException(
          "Authentication session is invalid or expired."
        );
      }

      if (isUnsafeHttpMethod(request.method)) {
        assertTrustedBrowserOrigin(request);
        if (!this.authentication.verifyCsrf(session, readCsrfHeader(request))) {
          throw new UnauthorizedException("Valid CSRF token is required.");
        }
      }

      userId = session.userId;
      request.authenticatedUserId = session.userId;
      request.authSessionId = session.sessionId;
    }

    if (!userId && process.env.NODE_ENV !== "production") {
      userId = process.env.CMS_DEV_USER_ID;
    }

    if (!userId) {
      throw new UnauthorizedException(
        "No authenticated platform principal is available."
      );
    }

    const result = await this.db.query<PlatformOperatorRow>(
      `SELECT po.user_id, po.role, po.status AS operator_status, u.status AS user_status
       FROM platform_operators po
       JOIN users u ON u.id = po.user_id
       WHERE po.user_id = $1`,
      [userId]
    );

    const row = result.rows[0];
    if (
      !row ||
      row.operator_status !== "ACTIVE" ||
      row.user_status !== "ACTIVE" ||
      !isPlatformRole(row.role)
    ) {
      throw new UnauthorizedException("Platform operator access is not active.");
    }

    const principal: PlatformPrincipal = {
      userId: row.user_id,
      role: row.role
    };
    request.platformPrincipal = principal;
    return true;
  }
}

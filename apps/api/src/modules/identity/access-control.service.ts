import { Injectable } from "@nestjs/common";
import {
  isAuthorized,
  type MembershipAccess,
  type Permission,
  type ResourceContext
} from "./domain/access-control.js";

@Injectable()
export class AccessControlService {
  can(
    membership: MembershipAccess,
    permission: Permission,
    resource: ResourceContext
  ): boolean {
    return isAuthorized(membership, permission, resource);
  }
}

import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";
import { CmsOrganizationDirectoryService } from "./cms-organization-directory.service.js";
import { CmsPlatformGuard } from "./cms-platform.guard.js";
import type { CmsRequest, PlatformPrincipal } from "./cms.types.js";

@Controller("cms/organization-directory")
@UseGuards(CmsPlatformGuard)
export class CmsOrganizationDirectoryController {
  constructor(
    private readonly organizations: CmsOrganizationDirectoryService
  ) {}

  @Get()
  search(
    @Req() request: CmsRequest,
    @Query("q") query?: string,
    @Query("plan") plan?: string,
    @Query("status") subscriptionStatus?: string,
    @Query("organizationStatus") organizationStatus?: string,
    @Query("delinquent") delinquent?: string,
    @Query("overLimit") overLimit?: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string
  ) {
    return this.organizations.search(this.principal(request), {
      query,
      plan,
      subscriptionStatus,
      organizationStatus,
      delinquent,
      overLimit,
      limit,
      cursor
    });
  }

  @Get(":organizationId")
  getById(
    @Req() request: CmsRequest,
    @Param("organizationId") organizationId: string
  ) {
    return this.organizations.getById(
      this.principal(request),
      organizationId
    );
  }

  private principal(request: CmsRequest): PlatformPrincipal {
    if (!request.platformPrincipal) {
      throw new Error("CmsPlatformGuard did not attach a principal.");
    }
    return request.platformPrincipal;
  }
}

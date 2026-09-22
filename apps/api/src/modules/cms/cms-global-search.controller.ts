import {
  Controller,
  Get,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";
import { CmsGlobalSearchService } from "./cms-global-search.service.js";
import { CmsPlatformGuard } from "./cms-platform.guard.js";
import type { CmsRequest, PlatformPrincipal } from "./cms.types.js";

@Controller("cms/search")
@UseGuards(CmsPlatformGuard)
export class CmsGlobalSearchController {
  constructor(private readonly searchService: CmsGlobalSearchService) {}

  @Get()
  search(
    @Req() request: CmsRequest,
    @Query("q") query?: string,
    @Query("limit") limit?: string
  ) {
    return this.searchService.search(this.principal(request), {
      query,
      limit
    });
  }

  private principal(request: CmsRequest): PlatformPrincipal {
    if (!request.platformPrincipal) {
      throw new Error("CmsPlatformGuard did not attach a principal.");
    }
    return request.platformPrincipal;
  }
}

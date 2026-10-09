import {
  BadRequestException, Body, Controller, Param, ParseUUIDPipe, Post, UseGuards
} from "@nestjs/common";
import { InternalServiceGuard } from "../../internal/internal-service.guard.js";
import { ZaloPersonalService } from "./zalo-personal.service.js";

@Controller("internal/zalo-personal")
@UseGuards(InternalServiceGuard)
export class ZaloPersonalInternalController {
  constructor(private readonly zalo: ZaloPersonalService) {}

  @Post("claim")
  claim() { return this.zalo.claim(); }

  @Post(":requestId/progress")
  progress(
    @Param("requestId", new ParseUUIDPipe({ version: "4" })) requestId: string,
    @Body() body: { qrImage?: unknown }
  ) {
    return this.zalo.progress(requestId, body?.qrImage);
  }

  @Post(":requestId/finish")
  finish(
    @Param("requestId", new ParseUUIDPipe({ version: "4" })) requestId: string,
    @Body() body: { status?: unknown; encryptedSession?: unknown; errorMessage?: unknown }
  ) {
    if (body?.status !== "CONNECTED" && body?.status !== "FAILED") {
      throw new BadRequestException("Invalid Zalo connection outcome.");
    }
    return this.zalo.finish(requestId, {
      status: body.status, encryptedSession: body.encryptedSession,
      errorMessage: body.errorMessage
    });
  }

  @Post("session/:jobId")
  session(@Param("jobId", new ParseUUIDPipe({ version: "4" })) jobId: string) {
    return this.zalo.sessionForJob(jobId);
  }

  @Post("session/:jobId/save")
  save(
    @Param("jobId", new ParseUUIDPipe({ version: "4" })) jobId: string,
    @Body() body: { encryptedSession?: unknown }
  ) {
    return this.zalo.updateSessionForJob(jobId, body?.encryptedSession);
  }
}

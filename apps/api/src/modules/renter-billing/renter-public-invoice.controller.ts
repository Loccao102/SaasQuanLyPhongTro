import {
  Controller,
  Get,
  MessageEvent,
  Param,
  Req,
  Sse
} from "@nestjs/common";
import type { Request } from "express";
import { from, map, Observable, switchMap, timer } from "rxjs";
import { AuthSecurityService } from "../identity/auth/auth-security.service.js";
import { RenterPublicInvoiceService } from "./renter-public-invoice.service.js";

@Controller("public/renter-invoices")
export class RenterPublicInvoiceController {
  constructor(
    private readonly publicInvoices: RenterPublicInvoiceService,
    private readonly security: AuthSecurityService
  ) {}

  @Get(":token")
  async detail(
    @Req() request: Request,
    @Param("token") token: string
  ) {
    await this.security.assertPublicInvoiceAllowed(this.requestIp(request));
    return this.publicInvoices.detail(token);
  }

  @Get(":token/portal")
  async portal(
    @Req() request: Request,
    @Param("token") token: string
  ) {
    await this.security.assertPublicInvoiceAllowed(this.requestIp(request));
    return this.publicInvoices.portal(token);
  }

  @Sse(":token/events")
  events(
    @Req() request: Request,
    @Param("token") token: string
  ): Observable<MessageEvent> {
    let last = "";
    return from(
      this.security.assertPublicInvoiceAllowed(this.requestIp(request))
    ).pipe(
      switchMap(() => timer(0, 3000)),
      switchMap(() => from(this.publicInvoices.status(token))),
      map((status) => {
        const serialized = JSON.stringify(status);
        const changed = serialized !== last;
        last = serialized;
        return {
          type: changed ? "payment-status" : "heartbeat",
          data: status
        };
      })
    );
  }

  private requestIp(request: Request): string {
    return request.ip || request.socket.remoteAddress || "unknown";
  }
}

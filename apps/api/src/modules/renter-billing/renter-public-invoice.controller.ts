import {
  Controller,
  Get,
  MessageEvent,
  Param,
  Sse
} from "@nestjs/common";
import { from, map, Observable, switchMap, timer } from "rxjs";
import { RenterPublicInvoiceService } from "./renter-public-invoice.service.js";

@Controller("public/renter-invoices")
export class RenterPublicInvoiceController {
  constructor(private readonly publicInvoices: RenterPublicInvoiceService) {}

  @Get(":token")
  detail(@Param("token") token: string) {
    return this.publicInvoices.detail(token);
  }

  @Sse(":token/events")
  events(@Param("token") token: string): Observable<MessageEvent> {
    let last = "";
    return timer(0, 3000).pipe(
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
}

import {
  BadRequestException,
  ConflictException,
  Controller,
  HttpCode,
  NotFoundException,
  Post,
  Req
} from "@nestjs/common";
import {
  BillingWebhookIngressRejectedError,
  type BillingWebhookHeaders
} from "./billing-webhook-ingress.service.js";
import { DevJsonBankWebhookIngressAdapter } from "./providers/dev-json-bank-webhook-ingress.adapter.js";
import { RenterPaymentWebhookIngressService } from "./renter-payment-webhook-ingress.service.js";
import { RenterPaymentWebhookConflictError } from "../renter-payments/renter-payment-webhook-inbox.service.js";

type RawWebhookRequest = {
  rawBody?: Buffer;
  headers: BillingWebhookHeaders;
};

@Controller("integrations/renter-payment-webhooks/dev-json-bank")
export class DevJsonBankRenterPaymentWebhookController {
  constructor(
    private readonly ingress: RenterPaymentWebhookIngressService,
    private readonly adapter: DevJsonBankWebhookIngressAdapter
  ) {}

  @Post()
  @HttpCode(202)
  async receive(@Req() request: RawWebhookRequest) {
    if (process.env.NODE_ENV === "production") {
      throw new NotFoundException();
    }
    if (!request.rawBody) {
      throw new BadRequestException("Raw webhook body is unavailable.");
    }

    try {
      const event = await this.ingress.accept(
        this.adapter,
        request.rawBody,
        request.headers
      );
      return {
        accepted: true,
        eventId: event.id,
        processingStatus: event.processingStatus,
        signatureStatus: event.signatureStatus
      };
    } catch (error) {
      if (error instanceof BillingWebhookIngressRejectedError) {
        throw new BadRequestException(error.message);
      }
      if (error instanceof RenterPaymentWebhookConflictError) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
  }
}

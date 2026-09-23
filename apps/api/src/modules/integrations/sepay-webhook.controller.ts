import {
  BadRequestException,
  ConflictException,
  Controller,
  HttpCode,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";
import {
  BillingWebhookIngressRejectedError,
  BillingWebhookIngressService,
  type BillingWebhookHeaders
} from "./billing-webhook-ingress.service.js";
import { SePayWebhookIngressAdapter } from "./providers/sepay-webhook-ingress.adapter.js";
import { BillingWebhookConflictError } from "./saas-billing-webhook-inbox.service.js";

type RawWebhookRequest = {
  rawBody?: Buffer;
  headers: BillingWebhookHeaders;
};

@Controller("integrations/billing-webhooks/sepay")
export class SePayWebhookController {
  constructor(
    private readonly ingress: BillingWebhookIngressService,
    private readonly adapter: SePayWebhookIngressAdapter
  ) {}

  @Post()
  @HttpCode(200)
  async receive(@Req() request: RawWebhookRequest) {
    if (!request.rawBody) {
      throw new BadRequestException(
        "Raw webhook body is unavailable."
      );
    }

    try {
      const event = await this.ingress.accept(
        this.adapter,
        request.rawBody,
        request.headers
      );

      if (event.signatureStatus === "NOT_CONFIGURED") {
        throw new ServiceUnavailableException(
          "SePay webhook authentication is not configured."
        );
      }
      if (event.signatureStatus !== "VERIFIED") {
        throw new UnauthorizedException(
          "Invalid or expired SePay webhook signature."
        );
      }

      return {
        success: true,
        eventId: event.id,
        processingStatus: event.processingStatus
      };
    } catch (error) {
      if (error instanceof BillingWebhookIngressRejectedError) {
        throw new BadRequestException(error.message);
      }
      if (error instanceof BillingWebhookConflictError) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
  }
}

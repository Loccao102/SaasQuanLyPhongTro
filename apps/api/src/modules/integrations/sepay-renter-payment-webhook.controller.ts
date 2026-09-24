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
  type BillingWebhookHeaders
} from "./billing-webhook-ingress.service.js";
import { RenterPaymentWebhookConflictError } from "../renter-payments/renter-payment-webhook-inbox.service.js";
import { RenterPaymentWebhookIngressService } from "./renter-payment-webhook-ingress.service.js";
import {
  SePayRenterPaymentWebhookIngressAdapter,
  SePayWebhookConfigurationError
} from "./providers/sepay-renter-payment-webhook-ingress.adapter.js";

type RawWebhookRequest = {
  rawBody?: Buffer;
  headers: BillingWebhookHeaders;
};

@Controller("integrations/renter-payment-webhooks/sepay")
export class SePayRenterPaymentWebhookController {
  constructor(
    private readonly ingress: RenterPaymentWebhookIngressService,
    private readonly adapter: SePayRenterPaymentWebhookIngressAdapter
  ) {}

  @Post()
  @HttpCode(200)
  async receive(@Req() request: RawWebhookRequest) {
    if (!request.rawBody) {
      throw new BadRequestException("Raw webhook body is unavailable.");
    }

    try {
      const event = await this.ingress.accept(
        this.adapter,
        request.rawBody,
        request.headers
      );

      if (event.signatureStatus !== "VERIFIED") {
        throw new UnauthorizedException("Invalid SePay webhook signature.");
      }

      return { success: true };
    } catch (error) {
      if (error instanceof SePayWebhookConfigurationError) {
        throw new ServiceUnavailableException(error.message);
      }
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

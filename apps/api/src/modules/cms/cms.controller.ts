import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import { CmsPlatformGuard } from "./cms-platform.guard.js";
import { CmsService } from "./cms.service.js";
import type {
  AllocateProviderPaymentInput,
  ChangeSubscriptionPlanInput,
  CmsRequest,
  PlatformPrincipal,
  ProvisionSubscriptionInput,
  RecordSubscriptionPaymentInput,
  RequeueBillingWebhookInput,
  RevokeEntitlementOverrideInput,
  RetryNotificationJobInput,
  TransitionSubscriptionInput,
  UpdateEntitlementOverrideInput,
  UpdateNotificationProviderControlInput,
  UpdatePlanInput,
  UpdateSettingInput
} from "./cms.types.js";

@Controller("cms")
@UseGuards(CmsPlatformGuard)
export class CmsController {
  constructor(private readonly cms: CmsService) {}

  @Get("bootstrap")
  getBootstrap(@Req() request: CmsRequest) {
    return this.cms.getBootstrap(this.principal(request));
  }

  @Get("dashboard")
  getDashboard(@Req() request: CmsRequest) {
    return this.cms.getDashboard(this.principal(request));
  }

  @Get("settings")
  listSettings(@Req() request: CmsRequest) {
    return this.cms.listSettings(this.principal(request));
  }

  @Patch("settings/:key")
  updateSetting(
    @Req() request: CmsRequest,
    @Param("key") key: string,
    @Body() input: UpdateSettingInput,
    @Headers("idempotency-key") idempotencyKey?: string
  ) {
    return this.cms.updateSetting(
      this.principal(request),
      key,
      input,
      idempotencyKey
    );
  }

  @Get("plans")
  listPlans(@Req() request: CmsRequest) {
    return this.cms.listPlans(this.principal(request));
  }

  @Patch("plans/:code")
  updatePlan(
    @Req() request: CmsRequest,
    @Param("code") code: string,
    @Body() input: UpdatePlanInput,
    @Headers("idempotency-key") idempotencyKey?: string
  ) {
    return this.cms.updatePlan(
      this.principal(request),
      code,
      input,
      idempotencyKey
    );
  }

  @Get("organizations")
  listOrganizations(@Req() request: CmsRequest) {
    return this.cms.listOrganizations(this.principal(request));
  }

  @Post("organizations/:organizationId/subscription")
  provisionSubscription(
    @Req() request: CmsRequest,
    @Param("organizationId") organizationId: string,
    @Body() input: ProvisionSubscriptionInput,
    @Headers("idempotency-key") idempotencyKey?: string
  ) {
    return this.cms.provisionSubscription(
      this.principal(request),
      organizationId,
      input,
      idempotencyKey
    );
  }

  @Post("organizations/:organizationId/subscription/transition")
  transitionSubscription(
    @Req() request: CmsRequest,
    @Param("organizationId") organizationId: string,
    @Body() input: TransitionSubscriptionInput,
    @Headers("idempotency-key") idempotencyKey?: string
  ) {
    return this.cms.transitionSubscription(
      this.principal(request),
      organizationId,
      input,
      idempotencyKey
    );
  }

  @Post("organizations/:organizationId/subscription/change-plan")
  changeSubscriptionPlan(
    @Req() request: CmsRequest,
    @Param("organizationId") organizationId: string,
    @Body() input: ChangeSubscriptionPlanInput,
    @Headers("idempotency-key") idempotencyKey?: string
  ) {
    return this.cms.changeSubscriptionPlan(
      this.principal(request),
      organizationId,
      input,
      idempotencyKey
    );
  }

  @Post("organizations/:organizationId/billing/payments/manual")
  recordSubscriptionPayment(
    @Req() request: CmsRequest,
    @Param("organizationId") organizationId: string,
    @Body() input: RecordSubscriptionPaymentInput,
    @Headers("idempotency-key") idempotencyKey?: string
  ) {
    return this.cms.recordSubscriptionPayment(
      this.principal(request),
      organizationId,
      input,
      idempotencyKey
    );
  }

  @Get("billing/reconciliation")
  getBillingReconciliation(@Req() request: CmsRequest) {
    return this.cms.getBillingReconciliation(this.principal(request));
  }

  @Post("billing/reconciliation/:paymentId/allocate")
  allocateProviderPayment(
    @Req() request: CmsRequest,
    @Param("paymentId") paymentId: string,
    @Body() input: AllocateProviderPaymentInput,
    @Headers("idempotency-key") idempotencyKey?: string
  ) {
    return this.cms.allocateProviderPayment(
      this.principal(request),
      paymentId,
      input,
      idempotencyKey
    );
  }

  @Post("billing/webhooks/:eventId/requeue")
  requeueBillingWebhook(
    @Req() request: CmsRequest,
    @Param("eventId") eventId: string,
    @Body() input: RequeueBillingWebhookInput,
    @Headers("idempotency-key") idempotencyKey?: string
  ) {
    return this.cms.requeueBillingWebhook(
      this.principal(request),
      eventId,
      input,
      idempotencyKey
    );
  }

  @Get("entitlement-overrides")
  listEntitlementOverrides(@Req() request: CmsRequest) {
    return this.cms.listEntitlementOverrides(this.principal(request));
  }

  @Patch("organizations/:organizationId/entitlement-overrides/:key")
  setEntitlementOverride(
    @Req() request: CmsRequest,
    @Param("organizationId") organizationId: string,
    @Param("key") key: string,
    @Body() input: UpdateEntitlementOverrideInput,
    @Headers("idempotency-key") idempotencyKey?: string
  ) {
    return this.cms.setEntitlementOverride(
      this.principal(request),
      organizationId,
      key,
      input,
      idempotencyKey
    );
  }

  @Post("organizations/:organizationId/entitlement-overrides/:key/revoke")
  revokeEntitlementOverride(
    @Req() request: CmsRequest,
    @Param("organizationId") organizationId: string,
    @Param("key") key: string,
    @Body() input: RevokeEntitlementOverrideInput,
    @Headers("idempotency-key") idempotencyKey?: string
  ) {
    return this.cms.revokeEntitlementOverride(
      this.principal(request),
      organizationId,
      key,
      input,
      idempotencyKey
    );
  }

  @Get("audit")
  listAudit(@Req() request: CmsRequest) {
    return this.cms.listAudit(this.principal(request));
  }

  @Get("jobs")
  listJobs(@Req() request: CmsRequest) {
    return this.cms.getJobsIntegrationStatus(this.principal(request));
  }

  @Patch("jobs/providers/:provider/control")
  updateNotificationProviderControl(
    @Req() request: CmsRequest,
    @Param("provider") provider: string,
    @Body() input: UpdateNotificationProviderControlInput,
    @Headers("idempotency-key") idempotencyKey?: string
  ) {
    return this.cms.updateNotificationProviderControl(
      this.principal(request),
      provider,
      input,
      idempotencyKey
    );
  }

  @Post("jobs/:jobId/retry")
  retryJob(
    @Req() request: CmsRequest,
    @Param("jobId") jobId: string,
    @Body() input: RetryNotificationJobInput,
    @Headers("idempotency-key") idempotencyKey?: string
  ) {
    return this.cms.retryJob(
      this.principal(request),
      jobId,
      input,
      idempotencyKey
    );
  }

  @Get("logs")
  listLogs(@Req() request: CmsRequest) {
    return this.cms.getLogsIntegrationStatus(this.principal(request));
  }

  private principal(request: CmsRequest): PlatformPrincipal {
    if (!request.platformPrincipal) {
      throw new Error("CmsPlatformGuard did not attach a principal.");
    }
    return request.platformPrincipal;
  }
}

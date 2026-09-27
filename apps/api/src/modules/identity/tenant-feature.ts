import { SetMetadata } from "@nestjs/common";
import type { TenantFeatureKey } from "../commercial/domain/entitlements.js";

export const TENANT_FEATURE_METADATA = "tenantFeature";

export const RequireTenantFeature = (feature: TenantFeatureKey) =>
  SetMetadata(TENANT_FEATURE_METADATA, feature);

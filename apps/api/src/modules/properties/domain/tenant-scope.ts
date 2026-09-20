export class CrossOrganizationReferenceError extends Error {
  constructor() {
    super("Resource belongs to a different organization.");
    this.name = "CrossOrganizationReferenceError";
  }
}

export function assertSameOrganization(
  expectedOrganizationId: string,
  resourceOrganizationId: string
): void {
  if (expectedOrganizationId !== resourceOrganizationId) {
    throw new CrossOrganizationReferenceError();
  }
}

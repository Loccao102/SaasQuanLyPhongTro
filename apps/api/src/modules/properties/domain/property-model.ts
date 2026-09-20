export type OrganizationId = string;
export type AdministrativeAreaId = string;
export type OperationalGroupId = string;
export type PropertyId = string;
export type FloorId = string;
export type RoomId = string;

export type OrganizationType = "INDIVIDUAL" | "HOUSEHOLD_BUSINESS" | "COMPANY";
export type PropertyType = "BOARDING_HOUSE" | "MINI_APARTMENT" | "APARTMENT" | "OTHER";

export interface AdministrativeArea {
  id: AdministrativeAreaId;
  parentId: AdministrativeAreaId | null;
  code: string | null;
  name: string;
  areaType: string;
  level: number;
  isActive: boolean;
}

export interface Property {
  id: PropertyId;
  organizationId: OrganizationId;
  administrativeAreaId: AdministrativeAreaId | null;
  code: string;
  name: string;
  propertyType: PropertyType;
  addressText: string | null;
  isActive: boolean;
}

export interface Floor {
  id: FloorId;
  organizationId: OrganizationId;
  propertyId: PropertyId;
  code: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

export interface Room {
  id: RoomId;
  organizationId: OrganizationId;
  propertyId: PropertyId;
  floorId: FloorId | null;
  code: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

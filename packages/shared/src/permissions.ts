import type { StaffRole } from './enums';

/** What each staff role may do. The API enforces it; the panel uses it to shape navigation. */
export const PERMISSIONS = {
  'orders.view': ['owner', 'manager', 'restaurant', 'cafe', 'cashier'],
  /** Cafe staff may accept only orders that contain nothing from the acceptance station. */
  'orders.accept': ['owner', 'manager', 'restaurant', 'cafe'],
  'tickets.update': ['owner', 'manager', 'restaurant', 'cafe'],
  'orders.handover': ['owner', 'manager', 'restaurant', 'cafe', 'cashier'],
  'payments.review': ['owner', 'manager', 'cashier'],
  'menu.view': ['owner', 'manager', 'restaurant', 'cafe', 'storage'],
  'menu.edit': ['owner', 'manager'],
  'menu.availability': ['owner', 'manager', 'restaurant', 'cafe'],
  'inventory.view': ['owner', 'manager', 'restaurant', 'cafe', 'storage'],
  'inventory.edit': ['owner', 'manager', 'storage'],
  'inventory.produce': ['owner', 'manager', 'storage', 'restaurant', 'cafe'],
  'members.view': ['owner', 'manager', 'cashier'],
  'members.edit': ['owner', 'manager', 'cashier'],
  /** VIP status, credit limits, personal discounts, wallet corrections. */
  'members.finance': ['owner', 'manager'],
  'club.edit': ['owner', 'manager'],
  'plans.edit': ['owner', 'manager'],
  'sms.send': ['owner', 'manager'],
  'analytics.view': ['owner', 'manager'],
  'settings.edit': ['owner', 'manager'],
  'staff.manage': ['owner', 'manager'],
  'branches.manage': ['owner'],
} as const satisfies Record<string, readonly StaffRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: StaffRole, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly StaffRole[]).includes(role);
}

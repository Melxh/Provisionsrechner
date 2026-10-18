import type { AddonInput, CommissionStatus, PercentAddonKey, ProjectType, Tier } from './types.ts';

export const TIER_LABELS: Record<Tier, string> = {
  starter: 'Starter',
  med: 'Med',
  pro: 'Pro',
  expert: 'Expert',
};

export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  pv: 'Photovoltaik',
  heat_pump: 'Wärmepumpe',
  pv_heat_pump: 'Photovoltaik und Wärmepumpe',
  other: 'Zusatzprodukt / sonstiger Auftrag',
};

export const STATUS_LABELS: Record<CommissionStatus, string> = {
  expected: 'Erwartet',
  open: 'Offen',
  paid: 'Ausgezahlt',
};

export const ADDON_LABELS: Record<PercentAddonKey | 'maintenance_package', string> = {
  ev_charger_a: 'Fox ESS EV-Charger A',
  wallbox_install: 'Montage Wallbox',
  longlife_battery: 'EV.longlifeakku Pro (ab dem 3. Akku)',
  extended_warranty: 'Erweiterte Herstellergarantien / PV Premium',
  eps_box_pro: 'Fox ESS EPS Box Pro',
  heat_pump_5_18: 'Wärmepumpe, 5–18 kW',
  maintenance_package: 'Wartungspaket',
};

export function addonLabel(a: AddonInput): string {
  const custom = a.label?.trim();
  if (a.key === 'custom') return custom ?? '';
  return custom || ADDON_LABELS[a.key];
}

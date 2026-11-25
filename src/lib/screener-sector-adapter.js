/**
 * Compatibility adapter between NSE 4-level industry classification and
 * Screener's sector/group filter (including legacy ?sector=<key> deep links).
 */

export const LEGACY_SECTOR_MAP = {
  bank: { type: "industry", value: "Banks", label: "Banks" },
  pvt_bank: { type: "basic_industry", value: "Private Sector Bank", label: "Private Sector Bank" },
  it: { type: "sector", value: "Information Technology", label: "Information Technology" },
  auto: { type: "sector", value: "Automobile and Auto Components", label: "Automobile and Auto Components" },
  fmcg: { type: "sector", value: "Fast Moving Consumer Goods", label: "Fast Moving Consumer Goods" },
  metal: { type: "sector", value: "Metals & Mining", label: "Metals & Mining" },
  realty: { type: "sector", value: "Realty", label: "Realty" },
  media: { type: "sector", value: "Media Entertainment & Publication", label: "Media Entertainment & Publication" },
  healthcare: { type: "sector", value: "Healthcare", label: "Healthcare" },
  consumer_durables: { type: "sector", value: "Consumer Durables", label: "Consumer Durables" },
  oil_gas: { type: "sector", value: "Oil Gas & Consumable Fuels", label: "Oil Gas & Consumable Fuels" },
  financial_services: { type: "sector", value: "Financial Services", label: "Financial Services" },
  capital_goods: { type: "sector", value: "Capital Goods", label: "Capital Goods" },
  chemicals: { type: "sector", value: "Chemicals", label: "Chemicals" },
  power: { type: "sector", value: "Power", label: "Power" },
  telecom: { type: "sector", value: "Telecommunication", label: "Telecommunication" },
  infra: { type: "sector", value: "Construction", label: "Construction" },
  energy: { type: "macro", value: "Energy", label: "Energy" },
  commodities: { type: "macro", value: "Commodities", label: "Commodities" },
};

export const AMBIGUOUS_LEGACY_SECTORS = {
  psu_bank: "PSU Bank index has no exact 1:1 level in the 4-level NSE taxonomy; use Banks or Public Sector Bank in Industries.",
  pse: "PSE (ownership thematic) has no 1:1 mapping in the NSE industry taxonomy.",
  mnc: "MNC (ownership thematic) has no 1:1 mapping in the NSE industry taxonomy.",
  pharma: "Use Healthcare / Pharmaceuticals in the NSE industry taxonomy.",
};

export const NSE_SECTORS = [
  "Automobile and Auto Components",
  "Capital Goods",
  "Chemicals",
  "Construction",
  "Construction Materials",
  "Consumer Durables",
  "Consumer Services",
  "Diversified",
  "Fast Moving Consumer Goods",
  "Financial Services",
  "Forest Materials",
  "Healthcare",
  "Information Technology",
  "Media Entertainment & Publication",
  "Metals & Mining",
  "Oil Gas & Consumable Fuels",
  "Power",
  "Realty",
  "Services",
  "Telecommunication",
  "Textiles",
  "Utilities",
];

export function resolveScreenerSectorParam(rawSector) {
  if (!rawSector || rawSector.toLowerCase() === "all") {
    return { mode: "all", label: "All Sectors" };
  }
  const trimmed = rawSector.trim();
  const lower = trimmed.toLowerCase();

  if (AMBIGUOUS_LEGACY_SECTORS[lower]) {
    return {
      mode: "unsupported",
      message: AMBIGUOUS_LEGACY_SECTORS[lower],
      label: trimmed,
    };
  }
  if (LEGACY_SECTOR_MAP[lower]) {
    const mapped = LEGACY_SECTOR_MAP[lower];
    return { mode: "mapped", ...mapped };
  }
  const exactNse = NSE_SECTORS.find((s) => s.toLowerCase() === lower);
  if (exactNse) {
    return { mode: "mapped", type: "sector", value: exactNse, label: exactNse };
  }
  return {
    mode: "unsupported",
    message: `Unsupported filter '${trimmed}'. Select a sector or group from Industries.`,
    label: trimmed,
  };
}

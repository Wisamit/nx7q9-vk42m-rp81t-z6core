import { minorToMoney4, money4ToMinor } from "./billing-adjustments.ts";

/**
 * Analytical money calculations must stay exact through aggregation.
 * Input and output represent currency minor units at the database's 4-decimal precision.
 */
export function addCurrencyAmount(map: Map<string, bigint>, currency: string, amount: string): void {
  const units = money4ToMinor(amount);
  if (units === null) throw new Error("INVALID_ANALYTICS_AMOUNT");
  map.set(currency, (map.get(currency) || BigInt(0)) + units);
}

export function moneyText(units: bigint, currency: string): string {
  const value = minorToMoney4(units);
  const negative = value.startsWith("-");
  const [whole, fraction] = (negative ? value.slice(1) : value).split(".");
  const displayFraction = fraction.replace(/0+$/, "").padEnd(2, "0");
  return currency + " " + (negative ? "-" : "") + BigInt(whole).toLocaleString("en-US") + "." + displayFraction;
}

export function financialText(value: string, currency: string): string {
  const positive = value.replace(/^-/, "");
  const units = money4ToMinor(positive);
  if (units === null) throw new Error("INVALID_ANALYTICS_AMOUNT");
  return moneyText(value.startsWith("-") ? -units : units, currency);
}

/**
 * Cost attributed to a current inventory-lot unit price is only an estimate, not
 * a historical cost snapshot. Suppress published margins if input coverage is
 * incomplete or if any attributed cost is indicative or non-comparable.
 */
export function comparableMargin(input: {
  revenue: Map<string, bigint>;
  cost: Map<string, bigint>;
  totalItems: number;
  coveredItems: number;
  indicativeCostItems: number;
}): Map<string, bigint> {
  const { revenue, cost, totalItems, coveredItems, indicativeCostItems } = input;
  if (totalItems <= 0 || coveredItems !== totalItems || indicativeCostItems > 0) return new Map();
  if ([...cost.keys()].some(currency => !revenue.has(currency))) return new Map();
  if (revenue.size !== 1 || cost.size !== 1) return new Map();
  const currency = [...revenue.keys()][0];
  if (!cost.has(currency)) return new Map();
  return new Map([[currency, revenue.get(currency)! - cost.get(currency)!]]);
}

/** A bounded query must not silently publish partial totals as complete. */
export function cappedDatasetNames(limits: Record<string, number>, actual: Record<string, number>): string[] {
  return Object.entries(limits).filter(([name, limit]) => (actual[name] || 0) >= limit).map(([name]) => name);
}

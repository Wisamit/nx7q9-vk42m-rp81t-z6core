import { minorToMoney4, money4ToMinor } from "./billing-adjustments.ts";

export type TaxTreatmentValue = "STANDARD" | "ZERO_RATED" | "EXEMPT";
export type TaxPriceModeValue = "EXCLUSIVE" | "INCLUSIVE";
export type TaxServiceKind = "TEST" | "PACKAGE";
export type EffectiveTaxRule = {
  id: string;
  branchId: string | null;
  testId: string | null;
  packageId: string | null;
  code: string;
  treatment: TaxTreatmentValue;
  priceMode: TaxPriceModeValue;
  ratePercent: string;
  effectiveFrom: string;
};

export function taxScopeKey(branchId: string | null, kind: TaxServiceKind, serviceId: string) {
  return `${branchId ? "BRANCH:" + branchId : "ORGANIZATION"}:${kind}:${serviceId}`;
}

export function resolveTaxRule(
  rules: EffectiveTaxRule[],
  branchId: string,
  kind: TaxServiceKind,
  serviceId: string,
  localDay: string,
): EffectiveTaxRule | null {
  return rules
    .filter(rule => rule.effectiveFrom <= localDay
      && (!rule.branchId || rule.branchId === branchId)
      && (kind === "TEST" ? rule.testId === serviceId : rule.packageId === serviceId))
    .sort((a, b) => Number(Boolean(b.branchId)) - Number(Boolean(a.branchId))
      || b.effectiveFrom.localeCompare(a.effectiveFrom)
      || a.id.localeCompare(b.id))[0] || null;
}

function percentageHundredths(value: string) {
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const result = BigInt(whole) * BigInt(100) + BigInt((fraction + "00").slice(0, 2));
  return result <= BigInt(10000) ? result : null;
}

export function validTaxRate(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  const bps = percentageHundredths(normalized);
  if (bps === null) return null;
  return `${bps / BigInt(100)}.${(bps % BigInt(100)).toString().padStart(2, "0")}`;
}

function roundRatio(numerator: bigint, denominator: bigint) {
  return (numerator * BigInt(2) + denominator) / (denominator * BigInt(2));
}

export function taxLineAmounts(input: {
  netAfterDiscount: string;
  rule: Pick<EffectiveTaxRule, "treatment" | "priceMode" | "ratePercent"> | null;
}) {
  const amount = money4ToMinor(input.netAfterDiscount);
  if (amount === null || amount < BigInt(0)) return null;
  const rule = input.rule;
  // Unrecognized signed/loaded policy values must not silently become
  // "INCLUSIVE" or "tax exempt" through a default ternary branch.
  if (rule && (
    !["STANDARD", "ZERO_RATED", "EXEMPT"].includes(rule.treatment) ||
    !["EXCLUSIVE", "INCLUSIVE"].includes(rule.priceMode)
  )) return null;
  const bps = rule ? percentageHundredths(rule.ratePercent) : BigInt(0);
  if (bps === null) return null;
  if (rule && ((rule.treatment !== "STANDARD" && bps !== BigInt(0)) ||
    (rule.treatment === "STANDARD" && bps === BigInt(0)))) return null;
  const tax = !rule || rule.treatment !== "STANDARD" ? BigInt(0)
    : rule.priceMode === "EXCLUSIVE"
      ? roundRatio(amount * bps, BigInt(10000))
      : roundRatio(amount * bps, BigInt(10000) + bps);
  const exclusive = Boolean(rule && rule.treatment === "STANDARD" && rule.priceMode === "EXCLUSIVE");
  return {
    taxableBase: minorToMoney4(amount - (!exclusive ? tax : BigInt(0))),
    taxAmount: minorToMoney4(tax),
    exclusiveTax: minorToMoney4(exclusive ? tax : BigInt(0)),
    lineTotal: minorToMoney4(amount + (exclusive ? tax : BigInt(0))),
  };
}

export function taxCreditReversal(input: {
  originalGross: string;
  originalTax: string;
  previouslyCreditedGross: string;
  previouslyCreditedTax: string;
  additionalGross: string;
}) {
  const vals = [input.originalGross, input.originalTax, input.previouslyCreditedGross, input.previouslyCreditedTax, input.additionalGross].map(money4ToMinor);
  if (vals.some(x => x === null)) return null;
  const [gross, tax, credited, creditedTax, add] = vals as bigint[];
  if (gross <= BigInt(0) || tax > gross || credited < BigInt(0)
    || credited + add > gross || add <= BigInt(0) || creditedTax > tax) return null;
  const grossAfter = credited + add;
  const proportionalTotalTax = grossAfter === gross ? tax : roundRatio(tax * grossAfter, gross);
  if (proportionalTotalTax < creditedTax) return null;
  return {
    taxAmount: minorToMoney4(proportionalTotalTax - creditedTax),
    totalTaxCredited: minorToMoney4(proportionalTotalTax),
  };
}

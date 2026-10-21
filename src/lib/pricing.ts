import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { comparePricingCandidates, samePricingPrecedence } from "@/lib/pricing-policy";

export class PricingConfigurationError extends Error {
  constructor(
    public readonly code:
      | "ambiguous_test_price_revision"
      | "ambiguous_package_price_revision"
      | "ambiguous_test_price_list"
      | "ambiguous_package_price_list",
    public readonly priceListId: string,
  ) {
    super(code);
  }
}

type DbClient = PrismaClient | Prisma.TransactionClient;

export async function resolveTestPrice(
  db: DbClient,
  input: {
    organizationId: string;
    branchId: string;
    sourceId?: string | null;
    referrerId?: string | null;
    clientId?: string | null;
    testId: string;
    at?: Date;
  },
) {
  const at = input.at ?? new Date();

  const activeContracts = input.clientId ? await db.contract.findMany({
    where: {
      organizationId: input.organizationId,
      clientId: input.clientId,
      status: "ACTIVE",
      effectiveFrom: { lte: at },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }],
    },
    select: { id: true },
  }) : [];
  const contractIds = activeContracts.map((x) => x.id);

  // Price revisions use half-open [effectiveFrom, effectiveTo), so a
  // version closed at the successor's start is never priced twice.
  const priceLists = await db.priceList.findMany({
    where: {
      organizationId: input.organizationId,
      status: "ACTIVE",
      effectiveFrom: { lte: at },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }],
      AND: [{
        OR: [
          { scopeType: "ORGANIZATION" },
          { scopeType: "BRANCH", branchId: input.branchId },
          ...(input.sourceId ? [{ scopeType: "SOURCE" as const, sourceId: input.sourceId }] : []),
          ...(input.referrerId ? [{ scopeType: "REFERRER" as const, referrerId: input.referrerId }] : []),
          ...(input.clientId ? [{ scopeType: "CLIENT" as const, clientId: input.clientId }] : []),
          ...(contractIds.length ? [{ scopeType: "CONTRACT" as const, contractId: { in: contractIds } }] : []),
        ],
      }],
      items: {
        some: {
          testId: input.testId,
          status: "ACTIVE",
          effectiveFrom: { lte: at },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
        },
      },
    },
    include: {
      items: {
        where: {
          testId: input.testId,
          status: "ACTIVE",
          effectiveFrom: { lte: at },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
        },
        orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
      },
    },
  });

  const ranked = priceLists
    .filter((list) => list.items.length > 0)
    .map((list) => ({ list }))
    .sort((a, b) => comparePricingCandidates(a.list, b.list));

  const selected = ranked[0]?.list;
  if (!selected) return null;
  const competing = ranked[1]?.list;
  if (competing && samePricingPrecedence(selected, competing)) {
    throw new PricingConfigurationError("ambiguous_test_price_list", selected.id);
  }
  if (selected.items.length !== 1) {
    throw new PricingConfigurationError("ambiguous_test_price_revision", selected.id);
  }
  const item = selected.items[0];

  return {
    priceListId: selected.id,
    priceListItemId: item.id,
    priceListCode: selected.code,
    scopeType: selected.scopeType,
    currency: selected.currency,
    unitPrice: item.unitPrice,
  };
}


export async function resolvePackagePrice(
  db: DbClient,
  input: {
    organizationId: string;
    branchId: string;
    sourceId?: string | null;
    referrerId?: string | null;
    clientId?: string | null;
    packageId: string;
    at?: Date;
  },
) {
  const at = input.at ?? new Date();

  const activeContracts = input.clientId ? await db.contract.findMany({
    where: {
      organizationId: input.organizationId,
      clientId: input.clientId,
      status: "ACTIVE",
      effectiveFrom: { lte: at },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }],
    },
    select: { id: true },
  }) : [];
  const contractIds = activeContracts.map((x) => x.id);

  const priceLists = await db.priceList.findMany({
    where: {
      organizationId: input.organizationId,
      status: "ACTIVE",
      effectiveFrom: { lte: at },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }],
      AND: [{
        OR: [
          { scopeType: "ORGANIZATION" },
          { scopeType: "BRANCH", branchId: input.branchId },
          ...(input.sourceId ? [{ scopeType: "SOURCE" as const, sourceId: input.sourceId }] : []),
          ...(input.referrerId ? [{ scopeType: "REFERRER" as const, referrerId: input.referrerId }] : []),
          ...(input.clientId ? [{ scopeType: "CLIENT" as const, clientId: input.clientId }] : []),
          ...(contractIds.length ? [{ scopeType: "CONTRACT" as const, contractId: { in: contractIds } }] : []),
        ],
      }],
      packageItems: {
        some: {
          packageId: input.packageId,
          status: "ACTIVE",
          effectiveFrom: { lte: at },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
        },
      },
    },
    include: {
      packageItems: {
        where: {
          packageId: input.packageId,
          status: "ACTIVE",
          effectiveFrom: { lte: at },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
        },
        orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
      },
    },
  });

  const ranked = priceLists
    .filter((list) => list.packageItems.length > 0)
    .map((list) => ({ list }))
    .sort((a, b) => comparePricingCandidates(a.list, b.list));

  const selected = ranked[0]?.list;
  if (!selected) return null;
  const competing = ranked[1]?.list;
  if (competing && samePricingPrecedence(selected, competing)) {
    throw new PricingConfigurationError("ambiguous_package_price_list", selected.id);
  }
  if (selected.packageItems.length !== 1) {
    throw new PricingConfigurationError("ambiguous_package_price_revision", selected.id);
  }
  const item = selected.packageItems[0];

  return {
    priceListId: selected.id,
    priceListPackageItemId: item.id,
    priceListCode: selected.code,
    scopeType: selected.scopeType,
    currency: selected.currency,
    unitPrice: item.unitPrice,
  };
}

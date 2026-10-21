import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { comparePricingCandidates, samePricingPrecedence } from "@/lib/pricing-policy";
import {
  projectF2EffectiveCatalogView, resolveF2EffectiveCatalogViews,
} from "@/lib/catalog-f2-effective-view";

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

/**
 * F2 schedules price-list priority, status and descriptions as immutable
 * as-of overlays instead of overwriting old price-list master rows. The
 * same effective choice must drive NEW billing quotes and order snapshots.
 * Effective dates and scope/ownership IDs are immutable in F2's plan, so
 * retain their typed live Prisma values (Date, UUID) rather than JSON.
 */
async function effectivePricedLists<T extends {
  id:string;status:string;effectiveFrom:Date;effectiveTo:Date|null;
}>(db:DbClient,organizationId:string,at:Date,lists:readonly T[]):Promise<T[]>{
  if(!lists.length)return [];
  const overlays=await resolveF2EffectiveCatalogViews(db as Prisma.TransactionClient,{
    organizationId,asOf:at,
    records:lists.map(list=>({entityType:"PRICE_LIST" as const,id:list.id})),
  });
  return lists.map(list=>{
    const updated=projectF2EffectiveCatalogView("PRICE_LIST",list,overlays);
    // The F2 plan forbids changing price-list effectiveFrom/effectiveTo and
    // identity fields, and these dates MUST remain native Prisma Date values.
    return {...updated,effectiveFrom:list.effectiveFrom,effectiveTo:list.effectiveTo};
  }).filter(list=>list.status==="ACTIVE");
}

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

  // Stored price revision endpoints are inclusive to preserve existing
  // manually authored tariff histories. F2 must close predecessor at
  // successorStart - 1 ms, not at the successor start instant.
  const priceLists = await db.priceList.findMany({
    where: {
      organizationId: input.organizationId,
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
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }],
        },
      },
    },
    include: {
      items: {
        where: {
          testId: input.testId,
          status: "ACTIVE",
          effectiveFrom: { lte: at },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }],
        },
        orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
      },
    },
  });

  const effectiveLists=await effectivePricedLists(
    db,input.organizationId,at,priceLists);
  const ranked = effectiveLists
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
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }],
        },
      },
    },
    include: {
      packageItems: {
        where: {
          packageId: input.packageId,
          status: "ACTIVE",
          effectiveFrom: { lte: at },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }],
        },
        orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
      },
    },
  });

  const effectiveLists=await effectivePricedLists(
    db,input.organizationId,at,priceLists);
  const ranked = effectiveLists
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

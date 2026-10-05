import type { Prisma, PrismaClient } from "../../generated/prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

const scopeRank = { CONTRACT: 400, CLIENT: 300, BRANCH: 200, ORGANIZATION: 100 } as const;

export async function resolveTestPrice(
  db: DbClient,
  input: {
    organizationId: string;
    branchId: string;
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
        orderBy: { effectiveFrom: "desc" },
        take: 1,
      },
    },
  });

  const ranked = priceLists
    .filter((list) => list.items.length > 0)
    .map((list) => ({ list, scopeRank: scopeRank[list.scopeType] }))
    .sort((a, b) =>
      b.scopeRank - a.scopeRank ||
      b.list.priority - a.list.priority ||
      b.list.effectiveFrom.getTime() - a.list.effectiveFrom.getTime()
    );

  const selected = ranked[0]?.list;
  const item = selected?.items[0];
  if (!selected || !item) return null;

  return {
    priceListId: selected.id,
    priceListItemId: item.id,
    priceListCode: selected.code,
    scopeType: selected.scopeType,
    currency: selected.currency,
    unitPrice: item.unitPrice,
  };
}

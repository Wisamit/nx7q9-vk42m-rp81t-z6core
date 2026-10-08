export type PriceRevisionLike = {
  id: string;
  status: "ACTIVE" | "INACTIVE";
  effectiveFrom: Date;
  effectiveTo: Date | null;
};

export type PriceRevisionPlan =
  | {
      ok: true;
      predecessorIdsToClose: string[];
      predecessorCloseAt: Date;
    }
  | {
      ok: false;
      error: "PRICE_REVISION_MUST_START_AFTER_LATEST";
      latestRevisionId: string;
      latestEffectiveFrom: Date;
    };

export function priceRevisionEffectiveAt(
  revision: Pick<PriceRevisionLike, "status" | "effectiveFrom" | "effectiveTo">,
  at: Date,
) {
  return revision.status === "ACTIVE"
    && revision.effectiveFrom <= at
    && (revision.effectiveTo === null || revision.effectiveTo >= at);
}

export function effectivePriceRevisions(
  revisions: PriceRevisionLike[],
  at: Date,
) {
  return revisions.filter(revision => priceRevisionEffectiveAt(revision, at));
}

export function planNextPriceRevision(
  existing: PriceRevisionLike[],
  effectiveFrom: Date,
): PriceRevisionPlan {
  const ordered = [...existing].sort((left, right) =>
    left.effectiveFrom.getTime() - right.effectiveFrom.getTime()
    || left.id.localeCompare(right.id)
  );
  const latest = ordered.at(-1);

  if (latest && effectiveFrom <= latest.effectiveFrom) {
    return {
      ok: false,
      error: "PRICE_REVISION_MUST_START_AFTER_LATEST",
      latestRevisionId: latest.id,
      latestEffectiveFrom: latest.effectiveFrom,
    };
  }

  return {
    ok: true,
    predecessorIdsToClose: ordered
      .filter(revision =>
        revision.status === "ACTIVE"
        && revision.effectiveFrom < effectiveFrom
        && (revision.effectiveTo === null || revision.effectiveTo >= effectiveFrom)
      )
      .map(revision => revision.id),
    predecessorCloseAt: new Date(effectiveFrom.getTime() - 1),
  };
}

export type ReportPresentationSection = {
  code: string;
  nameEn: string;
  nameAr: string | null;
  displayOrder: number;
  reportDisplayOrder: number | null;
  reportVisible: boolean;
};

export type ReportPresentationComponent = {
  code: string;
  nameEn: string;
  nameAr: string | null;
  displayOrder: number;
  reportNameEn: string | null;
  reportNameAr: string | null;
  reportDisplayOrder: number | null;
  reportVisible: boolean;
  resultSection: ReportPresentationSection | null;
};

export function snapshotReportPresentation(component: ReportPresentationComponent) {
  const section = component.resultSection;
  return {
    reportNameEnSnapshot: component.reportNameEn || component.nameEn,
    reportNameArSnapshot: component.reportNameAr || component.nameAr,
    reportDisplayOrderSnapshot: component.reportDisplayOrder ?? component.displayOrder,
    reportVisibleSnapshot: component.reportVisible && (section?.reportVisible ?? true),
    reportSectionCodeSnapshot: section?.code || null,
    reportSectionNameEnSnapshot: section?.nameEn || null,
    reportSectionNameArSnapshot: section?.nameAr || null,
    reportSectionOrderSnapshot: section ? section.reportDisplayOrder ?? section.displayOrder : null,
  };
}

export type ReportPresentationValue = {
  componentCode: string;
  reportDisplayOrder: number | null;
  reportVisible: boolean | null;
  reportSectionCode: string | null;
  reportSectionOrder: number | null;
};

export function reportValueVisible(value: Pick<ReportPresentationValue, "reportVisible">) {
  return value.reportVisible !== false;
}

export function compareReportPresentation(
  left: ReportPresentationValue,
  right: ReportPresentationValue,
) {
  const leftHasPresentation = left.reportDisplayOrder !== null || left.reportSectionOrder !== null;
  const rightHasPresentation = right.reportDisplayOrder !== null || right.reportSectionOrder !== null;

  if (!leftHasPresentation && !rightHasPresentation) {
    return left.componentCode.localeCompare(right.componentCode);
  }

  const leftSection = left.reportSectionOrder ?? Number.MAX_SAFE_INTEGER;
  const rightSection = right.reportSectionOrder ?? Number.MAX_SAFE_INTEGER;
  if (leftSection !== rightSection) return leftSection - rightSection;

  const leftOrder = left.reportDisplayOrder ?? Number.MAX_SAFE_INTEGER;
  const rightOrder = right.reportDisplayOrder ?? Number.MAX_SAFE_INTEGER;
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;

  return left.componentCode.localeCompare(right.componentCode);
}

export function reportSectionKey(value: Pick<ReportPresentationValue, "reportSectionCode">) {
  return value.reportSectionCode || "__UNGROUPED__";
}

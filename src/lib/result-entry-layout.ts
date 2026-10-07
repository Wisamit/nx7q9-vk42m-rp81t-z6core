export type ResultLayoutSection = {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string | null;
};

export type ResultLayoutField = {
  resultSectionId: string | null;
};

export type ResultFieldGroup<T extends ResultLayoutField> = ResultLayoutSection & {
  fields: T[];
};

export function groupResultFields<T extends ResultLayoutField>(
  fields: T[],
  sections: ResultLayoutSection[],
): ResultFieldGroup<T>[] {
  const activeSectionIds = new Set(sections.map(section => section.id));
  const groups: ResultFieldGroup<T>[] = sections
    .map(section => ({
      ...section,
      fields: fields.filter(field => field.resultSectionId === section.id),
    }))
    .filter(group => group.fields.length > 0);

  const ungrouped = fields.filter(field =>
    !field.resultSectionId || !activeSectionIds.has(field.resultSectionId)
  );

  if (ungrouped.length > 0) {
    groups.push({
      id: "",
      code: "",
      nameEn: "Other / Ungrouped",
      nameAr: "أخرى / بدون قسم",
      fields: ungrouped,
    });
  }

  return groups;
}

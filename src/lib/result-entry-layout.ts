export type ResultLayoutSection = {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string | null;
};

export type ResultLayoutField = {
  resultSectionId: string | null;
};

export type ResultFieldGroup<
  TField extends ResultLayoutField,
  TSection extends ResultLayoutSection = ResultLayoutSection,
> = TSection & {
  fields: TField[];
};

export function groupResultFields<
  TField extends ResultLayoutField,
  TSection extends ResultLayoutSection,
>(
  fields: TField[],
  sections: TSection[],
): ResultFieldGroup<TField, TSection>[] {
  const activeSectionIds = new Set(sections.map(section => section.id));
  const groups: ResultFieldGroup<TField, TSection>[] = sections
    .map(section => ({
      ...section,
      fields: fields.filter(field => field.resultSectionId === section.id),
    }))
    .filter(group => group.fields.length > 0);

  const ungrouped = fields.filter(field =>
    !field.resultSectionId || !activeSectionIds.has(field.resultSectionId)
  );

  if (ungrouped.length > 0) {
    const fallback = {
      ...(sections[0] || {
        id: "",
        code: "",
        nameEn: "Other / Ungrouped",
        nameAr: "أخرى / بدون قسم",
      }),
      id: "",
      code: "",
      nameEn: "Other / Ungrouped",
      nameAr: "أخرى / بدون قسم",
      fields: ungrouped,
    } as ResultFieldGroup<TField, TSection>;
    groups.push(fallback);
  }

  return groups;
}

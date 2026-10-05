type MicrobiologySummaryCase = {
  cultureStatus: string;
  finalComment: string | null;
  preliminaryComment: string | null;
  observations: Array<{ observationType: string; observationText: string }>;
  isolates: Array<{
    sequenceNumber: number;
    organismCodeSnapshot: string;
    organismNameEnSnapshot: string;
    quantityText: string | null;
    susceptibilityTests: Array<{
      method: string | null;
      results: Array<{
        antibioticCodeSnapshot: string;
        interpretation: string;
        micValue: { toString(): string } | null;
        micUnit: string | null;
        zoneDiameterMm: { toString(): string } | null;
      }>;
    }>;
  }>;
};

export function buildMicrobiologyDisplay(item: MicrobiologySummaryCase) {
  const lines: string[] = [];
  lines.push("Culture: " + item.cultureStatus.replaceAll("_", " "));

  for (const observation of item.observations) {
    lines.push(observation.observationType.replaceAll("_", " ") + ": " + observation.observationText);
  }

  for (const isolate of item.isolates) {
    const identity = "Isolate #" + isolate.sequenceNumber + ": " + isolate.organismCodeSnapshot + " — " + isolate.organismNameEnSnapshot;
    lines.push(isolate.quantityText ? identity + " (" + isolate.quantityText + ")" : identity);

    for (const susceptibility of isolate.susceptibilityTests) {
      if (susceptibility.method) lines.push("Susceptibility method: " + susceptibility.method);
      const ast = susceptibility.results.map(result => {
        const details: string[] = [];
        if (result.micValue !== null) details.push("MIC " + result.micValue.toString() + (result.micUnit ? " " + result.micUnit : ""));
        if (result.zoneDiameterMm !== null) details.push("Zone " + result.zoneDiameterMm.toString() + " mm");
        return result.antibioticCodeSnapshot + " " + result.interpretation + (details.length ? " [" + details.join(", ") + "]" : "");
      });
      if (ast.length) lines.push("AST: " + ast.join("; "));
    }
  }

  const comment = item.finalComment || item.preliminaryComment;
  if (comment) lines.push("Comment: " + comment);
  return lines.join("\n");
}

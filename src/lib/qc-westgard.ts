export type WestgardRuleCode = "1:2s" | "1:3s" | "2:2s" | "R:4s" | "4:1s" | "10x";

export type WestgardViolation = {
  ruleCode: WestgardRuleCode;
  severity: "WARNING" | "BLOCK";
  details: Record<string, unknown>;
};

function sameSide(values: number[]) {
  return values.every(value => value > 0) || values.every(value => value < 0);
}

export function evaluateWestgard(input: {
  currentZ: number;
  previousZ: number[];
  siblingZ?: number[];
  enabledRules: WestgardRuleCode[];
}): WestgardViolation[] {
  const violations: WestgardViolation[] = [];
  const enabled = new Set(input.enabledRules);
  const abs = Math.abs(input.currentZ);

  if (enabled.has("1:2s") && abs >= 2) {
    violations.push({
      ruleCode: "1:2s",
      severity: "WARNING",
      details: { currentZ: input.currentZ },
    });
  }

  if (enabled.has("1:3s") && abs >= 3) {
    violations.push({
      ruleCode: "1:3s",
      severity: "BLOCK",
      details: { currentZ: input.currentZ },
    });
  }

  if (enabled.has("2:2s")) {
    const consecutivePair = input.previousZ.length >= 1
      ? [input.previousZ[0], input.currentZ]
      : null;
    const sameRunSibling = (input.siblingZ || []).find(value =>
      Math.sign(value) === Math.sign(input.currentZ) &&
      Math.abs(value) >= 2 &&
      Math.abs(input.currentZ) >= 2
    );
    const sameRunPair = sameRunSibling === undefined ? null : [sameRunSibling, input.currentZ];
    const violatingPair =
      consecutivePair && sameSide(consecutivePair) && consecutivePair.every(value => Math.abs(value) >= 2)
        ? consecutivePair
        : sameRunPair;

    if (violatingPair) {
      violations.push({
        ruleCode: "2:2s",
        severity: "BLOCK",
        details: {
          zScores: violatingPair,
          mode: sameRunPair === violatingPair ? "SAME_RUN_LEVELS" : "CONSECUTIVE_RUNS",
        },
      });
    }
  }

  if (enabled.has("R:4s") && (input.siblingZ || []).some(value => Math.abs(value - input.currentZ) >= 4)) {
    violations.push({
      ruleCode: "R:4s",
      severity: "BLOCK",
      details: { currentZ: input.currentZ, siblingZ: input.siblingZ || [] },
    });
  }

  if (enabled.has("4:1s") && input.previousZ.length >= 3) {
    const sequence = [...input.previousZ.slice(0, 3).reverse(), input.currentZ];
    if (sameSide(sequence) && sequence.every(value => Math.abs(value) >= 1)) {
      violations.push({
        ruleCode: "4:1s",
        severity: "BLOCK",
        details: { zScores: sequence },
      });
    }
  }

  if (enabled.has("10x") && input.previousZ.length >= 9) {
    const sequence = [...input.previousZ.slice(0, 9).reverse(), input.currentZ];
    if (sameSide(sequence)) {
      violations.push({
        ruleCode: "10x",
        severity: "BLOCK",
        details: { zScores: sequence },
      });
    }
  }

  return violations;
}

export function normalizeWestgardRules(value: unknown): WestgardRuleCode[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<WestgardRuleCode>(["1:2s", "1:3s", "2:2s", "R:4s", "4:1s", "10x"]);
  return [...new Set(value.filter((rule): rule is WestgardRuleCode => typeof rule === "string" && allowed.has(rule as WestgardRuleCode)))];
}

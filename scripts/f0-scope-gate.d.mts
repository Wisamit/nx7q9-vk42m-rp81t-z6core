/** Typed surface of the F0 structural audit used by the TypeScript regression suite.
 * The Node CLI remains ESM JavaScript so it can execute without a build step.
 */
export type F0ScopeEvidence = {
  phase: "F0";
  baseline: string;
  sections: number;
  sourceAnchors: number;
  selectedTests: number;
  missingSelectedTests: number[];
  historicCategories: Record<string, number>;
  risks: number;
  unassignedRisks: number;
  pages: number;
  uat: Record<string, number>;
  browser: "NOT_EXECUTED";
  clinicalGo: "NO_GO";
  evidenceLimits: string;
  errors: string[];
  warnings: string[];
};

export declare function f0ScopeGate(input?: {
  ledger?: unknown;
  historical?: unknown;
  uat?: unknown;
  manifest?: unknown;
}): F0ScopeEvidence;

export declare function f0Markdown(report: F0ScopeEvidence): string;

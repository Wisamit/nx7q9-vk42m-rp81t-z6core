import type { Prisma } from "../../generated/prisma/client";
import { formulaVariables } from "./formula-engine.ts";
import type { GovernedClinicalRuleType } from "./clinical-rule-step-up.ts";

type Db = Prisma.TransactionClient;
type Failure = { ok: false; error: string };
type Result = { ok: true } | Failure;
type TestRecord = NonNullable<Awaited<ReturnType<typeof findActiveTest>>>;
type Scope = {
  organizationId: string;
  activeBranchId: string;
  permittedDepartmentIds: readonly string[];
  departmentRestricted: boolean;
};
const blocked = (error: string): Failure => ({ ok: false, error });

/** Only active tenant-owned catalog records can be referenced by an approval. */
async function findActiveTest(tx: Db, testId: string, scope: Scope) {
  const test = await tx.labTest.findFirst({
    where: { id: testId, organizationId: scope.organizationId, status: "ACTIVE" },
    select: {
      id: true, resultType: true, departmentId: true,
      department: { select: {
        organizationId: true, status: true,
        branch: { select: { organizationId: true, status: true } },
      } },
      components: { select: { id: true, code: true, status: true, resultType: true } },
    },
  });
  if (!test) return null;
  if (test.departmentId && (
    !test.department || test.department.organizationId !== scope.organizationId ||
    test.department.status !== "ACTIVE" ||
    (test.department.branch && (test.department.branch.status !== "ACTIVE" ||
      test.department.branch.organizationId !== scope.organizationId))
  )) return null;
  if (scope.departmentRestricted &&
      (!test.departmentId || !scope.permittedDepartmentIds.includes(test.departmentId))) return null;
  return test;
}

function activeComponent(test: TestRecord, componentId: string | null) {
  return componentId ? test.components.find(c => c.id === componentId && c.status === "ACTIVE") : null;
}

async function validBranch(tx: Db, branchId: string | null, scope: Scope): Promise<boolean> {
  if (!branchId) return true;
  if (branchId !== scope.activeBranchId) return false;
  return !!await tx.branch.findFirst({
    where: { id: branchId, organizationId: scope.organizationId, status: "ACTIVE" },
    select: { id: true },
  });
}

/**
 * Checked inside the same transaction AFTER the governance identity lock,
 * BEFORE step-up consumption, version supersession or rule activation.
 * This is referential eligibility, never a substitute for medical sign-off.
 */
export async function validateClinicalRuleApprovalReferences(
  tx: Db,
  input: {
    type: GovernedClinicalRuleType;
    id: string;
    organizationId: string;
    activeBranchId: string;
    userId: string;
    sessionDepartmentIds: readonly string[];
  },
): Promise<Result> {
  const liveDepartments = await tx.userDepartmentScope.findMany({
    where: { userId: input.userId },
    select: { departmentId: true, department: { select: {
      organizationId: true, status: true,
      branch: { select: { organizationId: true, status: true } },
    } } },
  });
  const priorRestriction = input.sessionDepartmentIds.length > 0;
  const original = new Set(input.sessionDepartmentIds);
  const permitted = liveDepartments.filter(row =>
    (!priorRestriction || original.has(row.departmentId)) &&
    row.department.status === "ACTIVE" &&
    row.department.organizationId === input.organizationId &&
    (!row.department.branch || (row.department.branch.organizationId === input.organizationId &&
      row.department.branch.status === "ACTIVE"))
  ).map(row => row.departmentId);
  if ((priorRestriction || liveDepartments.length > 0) && !permitted.length)
    return blocked("clinical_rule_department_scope_revoked");
  const scope: Scope = {
    organizationId: input.organizationId, activeBranchId: input.activeBranchId,
    permittedDepartmentIds: permitted,
    departmentRestricted: priorRestriction || liveDepartments.length > 0,
  };
  const test = (id: string) => findActiveTest(tx,id,scope);
  const branch = (id: string | null) => validBranch(tx,id,scope);

  switch (input.type) {
    case "CALCULATED_RESULT_RULE": {
      const rule = await tx.calculatedResultRule.findFirst({
        where: { id: input.id, organizationId: input.organizationId },
        select: { testId: true, targetComponentId: true, expression: true },
      });
      if (!rule) return blocked("clinical_rule_not_found");
      const source = await test(rule.testId);
      if (!source) return blocked("clinical_rule_test_inactive_or_forbidden");
      const target = activeComponent(source,rule.targetComponentId);
      if (!target || target.resultType !== "NUMERIC")
        return blocked("clinical_rule_calculated_target_inactive_or_invalid");
      let variables: string[];
      try { variables = formulaVariables(rule.expression); }
      catch { return blocked("invalid_formula"); }
      if (!variables.length) return blocked("formula_requires_component_variables");
      const codes = new Map(source.components.filter(c => c.status === "ACTIVE")
        .map(c => [c.code.toUpperCase(), c]));
      for (const variable of variables) {
        const component = codes.get(variable.toUpperCase());
        if (!component || component.resultType !== "NUMERIC" ||
            component.id === target.id) return blocked("clinical_rule_calculated_source_inactive_or_invalid");
      }
      return {ok:true};
    }
    case "REFLEX_RULE": {
      const rule = await tx.reflexRule.findFirst({
        where: { id: input.id, organizationId: input.organizationId },
        select: { sourceTestId: true, targetTestId: true, sourceComponentId: true,
          branchId: true, operator: true, numericThreshold: true, textThreshold: true },
      });
      if (!rule) return blocked("clinical_rule_not_found");
      if (!await branch(rule.branchId)) return blocked("clinical_rule_branch_inactive_or_forbidden");
      const [source,target] = await Promise.all([test(rule.sourceTestId),test(rule.targetTestId)]);
      if (!source || !target || source.id === target.id)
        return blocked("clinical_rule_test_inactive_or_forbidden");
      const component = activeComponent(source,rule.sourceComponentId);
      if ((rule.sourceComponentId && !component) ||
          (source.components.length > 0 && !component))
        return blocked("clinical_rule_source_component_inactive_or_mismatched");
      const resultType = component?.resultType ?? source.resultType;
      const numeric = ["LT","LTE","GT","GTE"].includes(rule.operator) ||
        (["EQ","NE"].includes(rule.operator) && resultType === "NUMERIC");
      if (numeric && (resultType !== "NUMERIC" || !rule.numericThreshold || rule.textThreshold))
        return blocked("clinical_rule_reflex_threshold_type_changed");
      if (!numeric && (!rule.textThreshold || rule.numericThreshold))
        return blocked("clinical_rule_reflex_threshold_type_changed");
      return {ok:true};
    }
    case "DELTA_RULE": {
      const rule = await tx.deltaRule.findFirst({
        where: { id: input.id, organizationId: input.organizationId },
        select: { testId: true, componentId: true, branchId: true, methodId: true,
          absoluteLimit: true, percentLimit: true },
      });
      if (!rule) return blocked("clinical_rule_not_found");
      if (!await branch(rule.branchId)) return blocked("clinical_rule_branch_inactive_or_forbidden");
      const source = await test(rule.testId);
      if (!source) return blocked("clinical_rule_test_inactive_or_forbidden");
      const component = activeComponent(source,rule.componentId);
      if (rule.componentId && !component)
        return blocked("clinical_rule_source_component_inactive_or_mismatched");
      if ((component?.resultType ?? source.resultType) !== "NUMERIC" ||
          (!rule.absoluteLimit && !rule.percentLimit))
        return blocked("clinical_rule_delta_numeric_source_required");
      if (rule.methodId && !await tx.method.findFirst({
        where: { id: rule.methodId, organizationId: input.organizationId, status: "ACTIVE" },
        select: { id: true },
      })) return blocked("clinical_rule_method_inactive_or_forbidden");
      return {ok:true};
    }
    case "AUTOVERIFICATION_POLICY":
    case "VALIDATION_HOLD_RULE":
    case "CRITICAL_ESCALATION_POLICY": {
      const rule = input.type === "AUTOVERIFICATION_POLICY"
        ? await tx.autoverificationPolicy.findFirst({
          where: { id: input.id, organizationId: input.organizationId },
          select: { testId: true, branchId: true },
        }) : input.type === "VALIDATION_HOLD_RULE"
          ? await tx.validationHoldRule.findFirst({
            where: { id: input.id, organizationId: input.organizationId },
            select: { testId: true, branchId: true },
          }) : await tx.criticalEscalationPolicy.findFirst({
            where: { id: input.id, organizationId: input.organizationId },
            select: { testId: true, branchId: true },
          });
      if (!rule) return blocked("clinical_rule_not_found");
      if (!await branch(rule.branchId)) return blocked("clinical_rule_branch_inactive_or_forbidden");
      if (!await test(rule.testId)) return blocked("clinical_rule_test_inactive_or_forbidden");
      return {ok:true};
    }
    case "RESULT_VALIDATION_POLICY": {
      const rule = await tx.resultValidationPolicy.findFirst({
        where: { id: input.id, organizationId: input.organizationId },
        select: { scope: true, testId: true, branchId: true, departmentId: true },
      });
      if (!rule) return blocked("clinical_rule_not_found");
      if (!await branch(rule.branchId)) return blocked("clinical_rule_branch_inactive_or_forbidden");
      if ((rule.scope === "ORGANIZATION" && (rule.testId || rule.departmentId)) ||
          (rule.scope === "DEPARTMENT" && (!rule.departmentId || rule.testId)) ||
          (rule.scope === "TEST" && (!rule.testId || rule.departmentId)))
        return blocked("clinical_rule_validation_scope_changed");
      if (rule.departmentId) {
        const department = await tx.department.findFirst({
          where: { id: rule.departmentId, organizationId: input.organizationId, status: "ACTIVE" },
          select: { id: true, branchId: true, branch: { select: {status:true} } },
        });
        if (!department || (department.branch && department.branch.status !== "ACTIVE") ||
            (rule.branchId && department.branchId && rule.branchId !== department.branchId) ||
            (scope.departmentRestricted && !scope.permittedDepartmentIds.includes(rule.departmentId)))
          return blocked("clinical_rule_department_inactive_or_forbidden");
      }
      if (rule.testId && !await test(rule.testId))
        return blocked("clinical_rule_test_inactive_or_forbidden");
      return {ok:true};
    }
  }
}

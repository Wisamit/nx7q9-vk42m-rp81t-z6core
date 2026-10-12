import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { LegacyMasterImportError, type LegacyMasterRow } from "./legacy-master-data-import";

type Database = PrismaClient | Prisma.TransactionClient;
export type CommentTarget = { testId: string | null; componentId: string | null };

/** Resolve target codes strictly inside the importing tenant. A component must
 * be ACTIVE and belong to the explicitly named ACTIVE test; never guess a link. */
export async function resolveLegacyCommentTargets(
  db: Database,
  organizationId: string,
  rows: readonly LegacyMasterRow[],
): Promise<CommentTarget[]> {
  const codes = [...new Set(rows.map(row => row.testCode).filter((v): v is string => Boolean(v)))];
  const tests = codes.length ? await db.labTest.findMany({
    where: { organizationId, code: { in: codes }, status: "ACTIVE" },
    select: {
      id: true, code: true,
      components: { where: { status: "ACTIVE" }, select: { id: true, code: true } },
    },
  }) : [];
  const byCode = new Map(tests.map(test => [test.code.toUpperCase(), test]));
  return rows.map(row => {
    if (row.commentScope === "ORGANIZATION") return { testId: null, componentId: null };
    const test = byCode.get(row.testCode || "");
    if (!test) throw new LegacyMasterImportError("comment_test_missing_or_inactive_row_" + row.rowNumber);
    if (row.commentScope === "TEST") return { testId: test.id, componentId: null };
    if (row.commentScope !== "COMPONENT")
      throw new LegacyMasterImportError("invalid_comment_scope_row_" + row.rowNumber);
    const component = test.components.find(item => item.code.toUpperCase() === row.componentCode);
    if (!component)
      throw new LegacyMasterImportError("comment_component_missing_or_inactive_row_" + row.rowNumber);
    return { testId: test.id, componentId: component.id };
  });
}

import { NextRequest } from "next/server";
import {
  runIndependentMappingPreflight, type Context,
} from "@/lib/catalog-mapping-inspection-preflight";

export const dynamic="force-dynamic";

/**
 * Read-only, non-signatory independent evidence inspection. The exact live
 * source/target proof and current grants are revalidated in shared preflight.
 */
export async function GET(request:NextRequest,context:Context){
  return runIndependentMappingPreflight(request,context);
}

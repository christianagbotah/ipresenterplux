import type { PoolClient } from "pg";
import {
  BibleLibraryError,
  resolveLocalScripture,
  type ResolvedLocalScripture
} from "./bible-library.ts";
import { PlannerItemError } from "./planner-item-schemas.ts";

export type ResolvedPlannerScripture = ResolvedLocalScripture;

export async function resolvePlannerScripture(
  client: PoolClient,
  reference: string,
  version: string
): Promise<ResolvedPlannerScripture> {
  try {
    return await resolveLocalScripture(client, { reference, version });
  } catch (error) {
    if (error instanceof BibleLibraryError) {
      throw new PlannerItemError(error.code, error.message);
    }
    throw error;
  }
}

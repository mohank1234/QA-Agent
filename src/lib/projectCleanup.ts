import { deleteProject, listExpiredGuestProjectIds } from "./db";
import { deleteObjectsWithPrefix } from "./storage";
import { logger } from "./logger";

// The one place that deletes a project completely (DB rows + its 5 R2
// object prefixes) — used by both the manual DELETE route and the
// guest-expiry sweep below, so the two can't drift out of sync on what
// "delete a project" actually means.
export async function deleteProjectCompletely(projectId: string): Promise<void> {
  await deleteProject(projectId);
  await Promise.all([
    deleteObjectsWithPrefix(`uploads/${projectId}/`),
    deleteObjectsWithPrefix(`exports/${projectId}/`),
    deleteObjectsWithPrefix(`generated/${projectId}/`),
    deleteObjectsWithPrefix(`runs/${projectId}/`),
    deleteObjectsWithPrefix(`sessions/${projectId}/`),
  ]);
}

const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes

async function sweepExpiredGuestProjects(): Promise<void> {
  const expiredIds = await listExpiredGuestProjectIds();
  for (const id of expiredIds) {
    try {
      await deleteProjectCompletely(id);
      logger.info({ projectId: id }, "deleted expired guest project");
    } catch (err) {
      logger.error({ err, projectId: id }, "failed to delete expired guest project");
    }
  }
}

// Called once from src/instrumentation.ts when the server starts. Not a
// precise "exactly 1 hour" guarantee — a project can outlive its expiresAt
// by up to SWEEP_INTERVAL_MS before actually being deleted. Runs once
// immediately too, so a server that's been down doesn't wait a full interval
// to catch up on a backlog.
export function startGuestProjectCleanupSweep(): void {
  sweepExpiredGuestProjects().catch((err) => logger.error({ err }, "initial guest cleanup sweep failed"));

  const timer = setInterval(() => {
    sweepExpiredGuestProjects().catch((err) => logger.error({ err }, "guest cleanup sweep failed"));
  }, SWEEP_INTERVAL_MS);
  timer.unref?.();
}

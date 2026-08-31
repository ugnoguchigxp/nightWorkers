/**
 * The pilot runner is normally launched as a Bun entry point, so focused
 * Vitest suites do not import it. Keep it in the TypeScript program without
 * executing its runtime bootstrap, which catches option/control drift in the
 * formal entry point itself.
 */
import type * as ProjectExplorationPilotRunner from "../scripts/run-project-exploration-paired-pilot";

export type ProjectExplorationPilotRunnerModule =
	typeof ProjectExplorationPilotRunner;

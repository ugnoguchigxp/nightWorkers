import { ensureNightWorkersSchema } from '../api/db/bootstrap';
import { applyVitestDatabaseEnv } from './vitest-db-env';

applyVitestDatabaseEnv();
await ensureNightWorkersSchema();

import { beforeAll } from 'vitest';
import { ensureNightWorkersSchema } from '../../../api/db/bootstrap';

beforeAll(async () => {
  await ensureNightWorkersSchema();
});

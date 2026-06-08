import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { config } from '../config';
import * as designQuestionnaireSchema from './design-questionnaire-schema';
import * as baseSchema from './schema';

export const client = createClient({
  url: config.DATABASE_URL.startsWith('file:')
    ? config.DATABASE_URL
    : `file:${config.DATABASE_URL}`,
});

export const db = drizzle(client, { schema: { ...baseSchema, ...designQuestionnaireSchema } });

export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

import { describe, expect, it, vi } from 'vitest';
import { wrapClientWithBusyRetry } from '../api/db/client';

describe('wrapClientWithBusyRetry', () => {
  it('retries client execute on SQLITE_BUSY', async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error('SQLITE_BUSY: database is locked'))
      .mockResolvedValueOnce({ rows: [{ ok: 1 }] });
    const client = wrapClientWithBusyRetry({
      execute,
      batch: vi.fn(),
      migrate: vi.fn(),
      executeMultiple: vi.fn(),
      transaction: vi.fn(),
      sync: vi.fn(),
      close: vi.fn(),
      reconnect: vi.fn(),
      closed: false,
      protocol: 'file',
    } as any);

    const result = await client.execute('select 1');

    expect(execute).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ rows: [{ ok: 1 }] });
  });

  it('retries transaction execute and commit on SQLITE_BUSY', async () => {
    const txExecute = vi
      .fn()
      .mockRejectedValueOnce(new Error('database is locked'))
      .mockResolvedValueOnce({ rows: [] });
    const commit = vi
      .fn()
      .mockRejectedValueOnce(new Error('cannot commit transaction - SQL statements in progress'))
      .mockResolvedValueOnce(undefined);
    const transaction = {
      execute: txExecute,
      batch: vi.fn(),
      executeMultiple: vi.fn(),
      rollback: vi.fn(),
      commit,
      close: vi.fn(),
      closed: false,
    };
    const client = wrapClientWithBusyRetry({
      execute: vi.fn(),
      batch: vi.fn(),
      migrate: vi.fn(),
      executeMultiple: vi.fn(),
      transaction: vi.fn().mockResolvedValue(transaction),
      sync: vi.fn(),
      close: vi.fn(),
      reconnect: vi.fn(),
      closed: false,
      protocol: 'file',
    } as any);

    const wrappedTx = await client.transaction('write');
    await wrappedTx.execute('insert into test values (1)');
    await wrappedTx.commit();

    expect(txExecute).toHaveBeenCalledTimes(2);
    expect(commit).toHaveBeenCalledTimes(2);
  });

  it('serializes write executes while leaving read executes unconstrained', async () => {
    const started: string[] = [];
    const finished: string[] = [];
    let releaseFirstWrite!: () => void;
    const firstWritePending = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    const execute = vi.fn(async (sql: string) => {
      started.push(sql);
      if (sql === 'insert into items values (1)') {
        await firstWritePending;
      }
      finished.push(sql);
      return { rows: [] };
    });
    const client = wrapClientWithBusyRetry({
      execute,
      batch: vi.fn(),
      migrate: vi.fn(),
      executeMultiple: vi.fn(),
      transaction: vi.fn(),
      sync: vi.fn(),
      close: vi.fn(),
      reconnect: vi.fn(),
      closed: false,
      protocol: 'file',
    } as any);

    const firstWrite = client.execute('insert into items values (1)');
    const read = client.execute('select * from items');
    const secondWrite = client.execute('update items set done = 1 where id = 1');

    await Promise.resolve();
    await read;

    expect(started).toContain('insert into items values (1)');
    expect(started).toContain('select * from items');
    expect(started).not.toContain('update items set done = 1 where id = 1');
    expect(finished).toEqual(['select * from items']);

    releaseFirstWrite();
    await Promise.all([firstWrite, secondWrite]);

    expect(started).toContain('update items set done = 1 where id = 1');
    expect(finished).toEqual([
      'select * from items',
      'insert into items values (1)',
      'update items set done = 1 where id = 1',
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import app from '../api/app';

describe('NightWorkers repositories routes', () => {
  it('registers a workspace repository successfully with valid data', async () => {
    const res = await app.request('http://localhost/api/repositories', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Valid Test Workspace',
        localPath: '/Users/y.noguchi/Code/nightWorkers',
        branch: 'main',
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty('id');
    expect(body.name).toBe('Valid Test Workspace');
    expect(body.localPath).toBe('/Users/y.noguchi/Code/nightWorkers');
  });

  it('returns 400 Bad Request if name is missing', async () => {
    const res = await app.request('http://localhost/api/repositories', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        localPath: '/Users/y.noguchi/Code/nightWorkers',
        branch: 'main',
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 Bad Request if localPath is missing', async () => {
    const res = await app.request('http://localhost/api/repositories', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Missing Path Workspace',
        branch: 'main',
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('deletes a workspace repository successfully', async () => {
    const createRes = await app.request('http://localhost/api/repositories', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'To Be Deleted',
        localPath: '/Users/y.noguchi/Code/nightWorkers',
        branch: 'main',
      }),
    });
    expect(createRes.status).toBe(201);
    const repo = await createRes.json();

    const deleteRes = await app.request(`http://localhost/api/repositories/${repo.id}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    expect(deleteRes.status).toBe(200);
    const deleteBody = await deleteRes.json();
    expect(deleteBody.id).toBe(repo.id);

    const getRes = await app.request(`http://localhost/api/repositories/${repo.id}`, {
      method: 'GET',
    });
    expect(getRes.status).toBe(404);
  });
});

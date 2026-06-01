import { hc } from 'hono/client';
import app from '../api/app';
import type { AppType } from '../api/app';

async function test() {
  const customFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString();
    return app.request(url, init);
  };

  const client = hc<AppType>('http://localhost/api', {
    fetch: customFetch,
  });

  console.log("Making POST request using Hono RPC client with direct app routing...");
  try {
    const res = await client.repositories.$post({
      json: {
        name: "Test HC Repo",
        localPath: "/Users/y.noguchi/Code/nightWorkers",
        branch: "main"
      }
    });
    console.log("Response Status:", res.status);
    console.log("Response JSON:", await res.json().catch((e) => e.message));
  } catch (err) {
    console.error("Error with HC:", err);
  }
}

test();

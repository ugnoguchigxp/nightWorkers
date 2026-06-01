import app from '../api/app';

async function test() {
  console.log("Simulating Hono API repository POST request...");
  try {
    const res = await app.request('http://localhost/api/repositories', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: "Test API Repo",
        localPath: "/Users/y.noguchi/Code/nightWorkers",
        branch: "main"
      })
    });
    
    console.log("Response Status:", res.status);
    console.log("Response Body:", await res.text());
  } catch (err) {
    console.error("Simulation error:", err);
  }
}

test();

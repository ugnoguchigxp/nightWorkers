import { createRepository } from '../api/modules/nightworkers/nightworkers.repository';

async function test() {
  try {
    const repo = await createRepository({
      name: "Test Repo",
      localPath: "/Users/y.noguchi/Code/nightWorkers",
      branch: "main"
    });
    console.log("Success:", repo);
  } catch (err) {
    console.error("Error inserting repository:", err);
  }
}

test();

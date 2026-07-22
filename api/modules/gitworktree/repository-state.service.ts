import { runGitCommand } from "./gitworktree-cli";

export async function repositoryHasGitHead(repositoryPath: string) {
	try {
		await runGitCommand([
			"-C",
			repositoryPath,
			"rev-parse",
			"--verify",
			"HEAD^{commit}",
		]);
		return true;
	} catch {
		return false;
	}
}

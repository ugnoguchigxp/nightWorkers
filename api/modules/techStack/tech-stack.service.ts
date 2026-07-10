import type { ProjectTechStackOverview } from "../../../shared/schemas/tech-stack.schema";
import { NotFoundError } from "../../lib/errors";
import * as nightworkersRepo from "../nightworkers/nightworkers.repository";
import { measureProjectCodeSize } from "./project-code-size.service";
import { detectProjectStackProfile } from "./project-stack-detector";
import * as repo from "./tech-stack.repository";

type RepositoryIdentity = {
	id: string;
	localPath: string;
};

const measurementsInFlight = new Map<string, Promise<ReturnTypeValue>>();
type ReturnTypeValue = Awaited<
	ReturnType<typeof repo.upsertProjectCodeSizeSnapshot>
>;

export async function readRepositoryTechStackOverview(
	repository: RepositoryIdentity,
): Promise<ProjectTechStackOverview> {
	const [stackProfile, codeSizeSnapshot] = await Promise.all([
		Promise.resolve().then(() =>
			detectProjectStackProfile(repository.localPath),
		),
		repo.getProjectCodeSizeSnapshot(repository.id),
	]);
	return { stackProfile, codeSizeSnapshot };
}

export async function getRepositoryTechStackOverview(repositoryId: string) {
	const repository = await nightworkersRepo.getRepository(repositoryId);
	if (!repository) throw new NotFoundError("Repository not found");
	return readRepositoryTechStackOverview(repository);
}

export async function measureAndSaveProjectCodeSize(repositoryId: string) {
	const existing = measurementsInFlight.get(repositoryId);
	if (existing) return existing;
	const promise = (async () => {
		const repository = await nightworkersRepo.getRepository(repositoryId);
		if (!repository) throw new NotFoundError("Repository not found");
		const measured = await measureProjectCodeSize(repository.localPath);
		return repo.upsertProjectCodeSizeSnapshot({ repositoryId, measured });
	})();
	measurementsInFlight.set(repositoryId, promise);
	try {
		return await promise;
	} finally {
		measurementsInFlight.delete(repositoryId);
	}
}

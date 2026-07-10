import { NotFoundError } from "../../lib/errors";
import * as nightworkersRepo from "../nightworkers/nightworkers.repository";
import { readRepositoryTechStackOverview } from "../techStack";
import { getFreshProjectMeta } from "./project-meta.service";

async function requireRepository(repositoryId: string) {
	const repository = await nightworkersRepo.getRepository(repositoryId);
	if (!repository) throw new NotFoundError("Repository not found");
	return repository;
}

export async function getProjectDetailMetrics(repositoryId: string) {
	const repository = await requireRepository(repositoryId);
	const [projectMeta, techStackOverview] = await Promise.all([
		getFreshProjectMeta(repository),
		readRepositoryTechStackOverview(repository),
	]);

	return {
		stackProfile: techStackOverview.stackProfile,
		codeSizeSnapshot: techStackOverview.codeSizeSnapshot,
		projectMeta,
	};
}

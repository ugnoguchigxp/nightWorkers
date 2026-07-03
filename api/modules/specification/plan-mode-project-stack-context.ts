import {
  detectProjectStackProfile,
  renderProjectStackContext,
} from '../../services/project-stack-context';
import * as nightworkersRepo from '../nightworkers/nightworkers.repository';

export async function resolvePlanModeProjectStackContext(repositoryId: string) {
  const repository = await nightworkersRepo.getRepository(repositoryId);
  if (!repository) return renderProjectStackContext(null);
  return renderProjectStackContext(detectProjectStackProfile(repository.localPath));
}

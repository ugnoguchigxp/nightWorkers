import { AppError } from '../../lib/errors';
import {
  type PlanModeCapability,
  readGeneralSettings,
} from '../../services/settings/general-settings';

export function assertPlanModeCapabilityEnabled(capability: PlanModeCapability) {
  const settings = readGeneralSettings();
  if (settings.planMode.capabilities[capability]) return;
  throw new AppError(
    409,
    'PLAN_MODE_CAPABILITY_DISABLED',
    `Plan Mode capability is disabled: ${capability}`,
    { capability }
  );
}

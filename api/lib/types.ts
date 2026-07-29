import type { Logger } from "pino";

export type AppVariables = {
	logger: Logger;
};

export type AppEnv = {
	Variables: AppVariables;
};

import { useEffect, useMemo } from "react";
import {
	CodingAgentCommandClient,
	type CodingAgentCommandClientOptions,
} from "./codingAgentCommandClient";

export function useCodingAgentCommandClient(
	getConnection: CodingAgentCommandClientOptions["getConnection"],
) {
	const client = useMemo(
		() => new CodingAgentCommandClient({ getConnection }),
		[getConnection],
	);
	useEffect(() => () => client.dispose(), [client]);
	return client;
}

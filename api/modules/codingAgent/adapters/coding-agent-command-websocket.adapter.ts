import type {
	CodingAgentCommandRequestV1,
	CodingAgentCommandResponseV1,
} from "../../../../shared/modules/codingAgent";
import { humanTaskOperatorPrincipal } from "../../taskOperator";
import { executeCodingAgentTransportCommand } from "../application/coding-agent-command.service";

export async function handleCodingAgentWebSocketCommand(
	request: CodingAgentCommandRequestV1,
): Promise<CodingAgentCommandResponseV1> {
	const result = await executeCodingAgentTransportCommand(
		request,
		humanTaskOperatorPrincipal(),
	);
	return result.response;
}

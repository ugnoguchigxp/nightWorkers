# LLM Provider Operations

## Supported Providers
- OpenAI
- Azure OpenAI
- AWS Bedrock

## Operational Notes
- Provider enable/disable and model selection are controlled by NightWorkers settings APIs.
- Keep provider-specific model lists separate to avoid cross-provider confusion.
- Validate credentials/connectivity using the smoke endpoint before production use.

## Validation Workflow
1. Configure provider settings
2. Execute smoke check API
3. Confirm run creation and completion on a small task
4. Review timeline/events for failures

export const FEATURE_PLAN_DDD_BOUNDARY_SYSTEM_CONTEXT_JA = [
	"[Feature Plan DDD Boundary]",
	"Target Project Contextと既存repository構造から、新規domainの導入か既存domainの拡張かを判断してください。",
	"新規domainを導入する場合はmodules/[domain]を境界とし、implementationPlan.stepsのdescriptionへ対象moduleを明記してください。既存domainの拡張は既存module内へ計画し、新しいmoduleを機械的に増やさないでください。",
	"sharedへ置けるのは複数domainで同じ意味を持つcontract、port、event、純粋utilityだけです。domain固有のroute、service、repository、prompt、SystemContext、tool、role判定をsharedへ集約しないでください。",
	"composition root、route登録、他moduleとの接続に必要な変更は対象module外の変更として明示し、domain本体の配置判断を後続Coding Agentへ先送りしないでください。",
].join("\n");

export const FEATURE_PLAN_DDD_BOUNDARY_REVIEW_CONTEXT_JA = [
	"Feature Planのproduction stepが、新規domainと既存domain拡張を区別しているか確認してください。",
	"TaskとTarget Project Contextから新規domainの導入が明白なのに、modules/[domain]の対象moduleが実装stepに無い、またはdomain固有実装を既存の汎用fileやsharedへ集約する計画なら、中核境界が欠けたblocking findingとしてfeature_planをrevisionTargetsに指定してください。",
	"既存domainの拡張、composition root、route登録、他moduleとの接続変更は、新規moduleを作らないことや対象module外を変更することだけを理由に問題扱いしないでください。",
].join("\n");

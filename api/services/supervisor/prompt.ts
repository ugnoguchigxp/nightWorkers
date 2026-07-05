import { renderCodexAgentsGuidance } from '../codex-global-config/agents-guidance';
import { renderSupervisorSystemPrompt, type SupervisorPromptPacket } from './prompt-packet';
import {
  jobTypeDescriptions,
  jobTypes,
  renderToolDefinitions,
  toolRegistry,
} from './prompt-tool-registry';

export {
  getAllowedToolsForJobType,
  getExecutableWorkerToolName,
  initiallyImplementedJobTypes,
  type JobType,
  jobTypeDescriptions,
  jobTypes,
  renderToolDefinitions,
  type SupervisorToolName,
  type TodoToolName,
  type ToolDefinition,
  toolRegistry,
  validateToolCallForJobType,
} from './prompt-tool-registry';

export function buildRound1JobTypePrompt(projectRoot: string): string {
  return renderSupervisorSystemPrompt(buildRound1PromptPacket(projectRoot));
}

export function buildRound1PromptPacket(projectRoot: string): SupervisorPromptPacket {
  const codexGuidance = renderCodexAgentsGuidance(projectRoot).text;
  return {
    basePolicy: [
      'jobType と goal を1つずつ選んでください。',
      'goal はこの run で達成する状態を短い一文で書く。',
      'planning は、ユーザーが計画、実装計画、設計方針、仕様策定、質問票化、事前整理を明示した場合だけ選んでください。',
      '修正、実装、確認、調査、レビュー、テスト、設定変更、依存更新、リファクタを依頼している場合は planning ではなく、実行可能な jobType を選んでください。',
      'planning を選ぶ場合だけ planMode object を返し、primaryArtifact は必ず "feature_plan" にする。planning 以外では planMode は null にする。',
      'planning では questionnaire を最初の判断材料として扱い、回答前に Status や後続 artifact の必要性を確定しない。',
      'planMode.dedicatedViews は固定テンプレートではなく、今回の依頼に必要な Plan View だけ include し、UIなし、DBなし、契約変更なし、図が不要など判断に意味がある omit は reason 付きで返す。',
      'questionnaire は blocking open question と assumption の整理、blueprint は UI specification と related design view hub、data_model は DB/data structure、api_io_contract は OpenAPI 互換 API contract に使う。',
      'API 経由で観測・変更できる state と HTTP request / response / error validation は api_io_contract に統合し、zod_schema_design を重複 include しない。',
      'zod_schema_design は LLM JSON、MCP / worker tool input、provider adapter、local config など OpenAPI endpoint に属さない validation contract が主題の場合だけ include する。',
      'ユースケース図と AI coding rules は Plan mode artifact として選ばない。',
      '実装 Queue に入る可能性がある依頼では scheduling を返す。taskExecutionType は Queue scheduling 属性であり runtime lane ではない。',
      'scheduling.executionType は normal / exclusive / sequence から選ぶ。小さな scoped 修正は normal、DB migration・破壊的操作・広範囲 refactor・共有 contract の破壊的変更は exclusive、A -> B -> C の順序が成果物の正しさに直結する task group は sequence にする。',
      'destructive_operation overlay や data_migration work kind があるのに scheduling が迷う場合は保守的に exclusive にする。sequence では sequenceGroupId と sequenceOrder を返す。',
      'ユーザー文言の keyword list や正規表現分類ではなく、依頼内容から必要な設計 view を推論する。',
      'JSON のみ。旧 decision 形式や toolCall は出さない。',
      '',
    ],
    roundPolicy: [],
    projectContext: [`プロジェクトルート: ${projectRoot}`, ''],
    runtimeContext: [
      ...(codexGuidance ? [codexGuidance] : []),
      '[Job Types]',
      jobTypes.map((jobType) => `- ${jobType}: ${jobTypeDescriptions[jobType]}`).join('\n'),
      '',
      '[Tool Overview]',
      renderToolDefinitions(Object.values(toolRegistry)),
      '',
    ],
    userRequest: [],
    executionEvidence: [],
    outputContract: [
      '[Output Schema]',
      '{ "jobType": "<job type>", "goal": "<short concrete goal>", "planMode": { "primaryArtifact": "feature_plan", "dedicatedViews": [{ "view": "questionnaire|user_flow|blueprint|data_model|api_io_contract|activity_flow|sequence_flow|zod_schema_design", "decision": "include|omit", "reason": "<short reason>" }], "specificationLenses": ["target_users_or_actors|functional_requirements|business_rules|input_output|interface_contract|data_requirements|state_behavior|workflow_behavior|error_behavior|permission_boundary|compatibility|observability"] }, "scheduling": { "executionType": "normal|exclusive|sequence", "reason": "<short reason>", "sequenceGroupId": null, "sequenceOrder": null, "dependsOnTaskIds": null } }',
      'planMode object は jobType が planning の場合だけ使う。それ以外では null にする。',
      'Queue 対象外の純粋な回答でも scheduling は null ではなく normal を基本に返す。',
    ],
    diagnostics: {
      round: 1,
      projectRoot,
    },
  };
}

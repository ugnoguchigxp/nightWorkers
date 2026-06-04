import {
  legacyWorkflowToRoutingHypothesis,
  normalizeSupervisorRoutingHypothesis,
  renderSupervisorSkillDocuments,
  resolveSupervisorSkillDocuments,
  summarizeSupervisorSkillDocuments,
} from './skills/registry';
import {
  type SupervisorRoutingHypothesis,
  supervisorModes,
  supervisorOverlays,
  supervisorPhases,
  supervisorWorkKinds,
} from './skills/types';

export type SupervisorWorkflow = 'general' | 'evidence_review' | 'code_change' | 'research';
export type { SupervisorRoutingHypothesis };

const TOOL_CATALOG = [
  { name: 'list_dir', description: 'リポジトリ内のディレクトリを一覧する。' },
  { name: 'find_file', description: '正確なパスが不明なとき、ファイルマスクで候補を探す。' },
  {
    name: 'read_file',
    description:
      'レビューや編集の前に、リポジトリ内のファイルを読む。デフォルトは圧縮ビュー。完全な従来出力が必要な場合だけ compressionMode="off" または行範囲を使う。',
  },
  {
    name: 'inspect_structure',
    description:
      '大きな TypeScript/JavaScript/JSON を読む前に構造だけ確認する。TS/JS は import と symbol、JSON は値ではなくパスと型を返す。',
  },
  {
    name: 'search_files',
    description: '直接読むだけでは足りないとき、リポジトリ内の文字列を検索する。',
  },
  { name: 'search_web', description: '最新の外部情報が必要なとき、公開 Web を検索する。' },
  {
    name: 'fetch_content',
    description: '検索で選んだ URL の本文を読む。検索結果 snippet だけを根拠にしない。',
  },
  { name: 'git_status', description: '作業ツリーの状態を確認する。' },
  { name: 'git_diff', description: 'リポジトリの差分を確認する。' },
  {
    name: 'replace_content',
    description:
      '既存ファイルの編集で優先する。対象が1箇所に限定できる単純なリテラル/regex 置換を行う。',
  },
  {
    name: 'apply_patch',
    description:
      '新規ファイル作成、複数ファイル変更、構造的な編集を unified diff で行う。既存ファイルの単純置換では replace_content を優先する。',
  },
  {
    name: 'run_command',
    description:
      'ポリシーの範囲内で検証コマンドやリポジトリのスクリプトを実行する。巨大出力はデフォルトでエラー周辺と末尾中心に圧縮される。',
  },
] as const;

const TOOL_CALL_SHAPE = `toolCall: {
  name: string,
  arguments: object
} | null`;

export type ExternalSupervisorToolCatalogEntry = {
  namespacedName: string;
  serverId: string;
  toolName: string;
  description?: string;
};

function buildToolCatalog(externalTools: ExternalSupervisorToolCatalogEntry[] = []): string {
  const externalToolLines =
    externalTools.length === 0
      ? ['- なし']
      : externalTools.map(
          (tool) =>
            `- ${tool.namespacedName}: ${tool.description || 'MCP server tool'}。使う場合は toolCall.name="mcp_call_tool"、arguments.serverId="${tool.serverId}"、arguments.toolName="${tool.toolName}"、arguments.arguments にそのツールの引数を入れる。`
        );
  return `[Tool catalog]
このセクションだけを worker ツール名、詳細情報、使うべきタイミングの根拠にしてください。
${TOOL_CATALOG.map((tool) => `- ${tool.name}: ${tool.description}`).join('\n')}
- mcp_call_tool: 設定済み MCP Server の tool を呼び出す bridge。下の External MCP tools に listed された tool だけに使う。

[External MCP tools]
${externalToolLines.join('\n')}

[toolCall スキーマ]
${TOOL_CALL_SHAPE}

toolCall.name は必ず Tool catalog にある内部 worker ツール名だけを使う。External MCP tools の名前を直接 toolCall.name に入れず、mcp_call_tool に正規化して返す。`;
}

function buildDecisionContract(): string {
  return `[Decision JSON 契約]
JSON のみを返してください。markdown のコードブロックで囲まないでください。
必須キー:
- phase: observe | plan | act | verify | report | stop
- workflow: general | evidence_review | code_change | research。legacy 互換フィールドです。routingHypothesis から最も近い値を入れてください。
- routingHypothesis: object
- instruction: string
- rationale: string
- finalResponse: string
- expectedEvidence: string[]
- riskLevel: low | medium | high
- toolCall: ${TOOL_CALL_SHAPE}
- terminalState: needs_review | completed | blocked | failed | timed_out | cancelled | needs_human。phase が stop のときだけ指定する。

terminalState は phase="stop" のときだけキーを出してください。phase が stop 以外のときは terminalState キー自体を省略し、null を返してはいけません。
toolCall.name を返す場合は、同じ prompt 内の Tool catalog だけを参照してください。
利用できないツール名を返してはいけません。例: mcp__*, functions.*, exec_command, shell namespace。

routingHypothesis は次の形にしてください:
{
  primaryMode: ${supervisorModes.join(' | ')},
  secondaryModes: string[],
  phase: ${supervisorPhases.join(' | ')},
  workKinds: string[],
  overlays: string[],
  subtype?: string,
  requiredEvidence: string[],
  nextSkillFiles: string[],
  confidence: number
}

phase / primaryMode / secondaryModes / workKinds / overlays は観測結果で変わり得ます。現在の routing が不適切なら、同じ decision 内で更新してください。`;
}

function buildBaseSystemContext(projectRoot?: string): string {
  return `[SystemContext]
あなたはコーディングエージェントです。ユーザーの目的を完遂するため、必要な調査、実行、検証を行い、構造化された decision を返してください。
${projectRoot ? `プロジェクトルート: ${projectRoot}` : ''}

[基本ルール]
- 証拠が必要な場合、phase="stop" の前に必ず証拠を取得する。
- 外部の最新情報が必要な場合、検索結果だけで判断せず本文を確認する。
- 編集が必要な場合、対象確認、編集、検証の順で進める。
- finalResponse はユーザーに見える最終回答です。停止時の実際の結果は instruction や rationale ではなく finalResponse に書く。
- 判断に迷う場合は、推測で完了扱いにせず、次に必要な証拠または検証を取得する。`;
}

function buildWorkflowSelectionContext(projectRoot: string): string {
  return `${buildBaseSystemContext(projectRoot)}

[Round 1: routing hypothesis]
単一分類を確定せず、routing hypothesis を返してください。
- primaryMode は1つだけ選ぶ。
- secondaryModes / workKinds / overlays は必要なら複数選ぶ。
- phase は現在位置を表す: ${supervisorPhases.join(' | ')}
- primaryMode / secondaryModes の候補: ${supervisorModes.join(' | ')}
- workKinds の候補: ${supervisorWorkKinds.join(' | ')}
- overlays の候補: ${supervisorOverlays.join(' | ')}

[Blueprint routing]
次のような依頼は Blueprint タスクとして扱ってください:
- 「試作して」「プロトタイプを見たい」「プレビューを作って」
- 「どんなイメージか教えて」「完成イメージを見たい」「画面案を見たい」
- 「Blueprint を見たい」「Blueprint で作って」「Blueprint を更新して」
- 実装前に ECサイトトップページ、ダッシュボード、管理画面などの画面構成、セクション、データ連携を確認したい依頼

この場合 routingHypothesis は原則として次の形に寄せてください:
- primaryMode: planning
- secondaryModes: ['review'] または []
- phase: plan
- workKinds: ['blueprint', 'ui_ux']。ドキュメントだけが目的なら docs も追加する。
- overlays: ['user_facing_change']
- subtype: 'app_blueprint'
- nextSkillFiles: ['references/work_kinds/blueprint.md'] を含める。

workflow は legacy 互換のため、routing に最も近い general | evidence_review | code_change | research のどれかを入れてください。
Round 1 は基本的に phase="plan" または phase="observe" を返してください。リポジトリ証拠や Web 証拠を本当に必要としない軽い会話だけ、phase="stop" を許可します。
Round 1 では toolCall を原則 null にしてください。実行手段の選択は Round 2 の Tool catalog に基づいて行います。

${buildDecisionContract()}`;
}

export function buildRound1SystemPrompt(projectRoot: string): string {
  return buildWorkflowSelectionContext(projectRoot);
}

export function buildRound2SystemPrompt(
  routingOrWorkflow: SupervisorWorkflow | Partial<SupervisorRoutingHypothesis> = 'general',
  options?: {
    projectRoot?: string;
    skillsDirectory?: string;
    externalTools?: ExternalSupervisorToolCatalogEntry[];
  }
): string {
  const routing =
    typeof routingOrWorkflow === 'string'
      ? legacyWorkflowToRoutingHypothesis(routingOrWorkflow)
      : normalizeSupervisorRoutingHypothesis(routingOrWorkflow);
  const skillDocuments = resolveSupervisorSkillDocuments(routing, options?.skillsDirectory);
  const skillDocumentSummary = summarizeSupervisorSkillDocuments(skillDocuments);

  return `${buildBaseSystemContext(options?.projectRoot)}

[Round 2: 実行]
Round 1 で選んだ workflow に従い、次の具体的な1手を決めてください。
ユーザー入力は JSON で渡されます。latestUserMessage は元の依頼、round1Decision は routing hypothesis を含む Round 1 結果、todoPlan は run 内の Todo と procedure/context の要約、observations はこれまでの worker ツール実行結果です。
todoPlan がある場合、現在の実行は Todo を順番に完了する前提で進め、未完了 Todo を finalResponse で完了扱いにしないでください。
evidence overlay または調査・レビュー系 mode では、observations が空ならユーザー向け回答を作らず、まず toolCall で証拠を取得してください。
証拠がある場合は、その証拠だけを根拠に finalResponse を完成させてください。
worker tool の実行結果が observations に無い場合、cp / mv / touch / apply_patch / replace_content / run_command を実行済み、失敗済み、拒否済みだと書いてはいけません。
リポジトリへの読み書きは必ず Tool catalog の worker toolCall で行ってください。Codex 自身のローカルファイル操作や別経路の編集を、リポジトリ変更の根拠として扱ってはいけません。
code_edit では、編集ツールを実行していないまま read-only / 書き込み不可 / 権限不足を理由に phase="stop" を返してはいけません。

[Routing Hypothesis]
${JSON.stringify(routing, null, 2)}

[Loaded Skill Documents]
${JSON.stringify(skillDocumentSummary, null, 2)}

${renderSupervisorSkillDocuments(skillDocuments)}

[Re-evaluation Gate]
toolCall または phase="stop" を返す前に、次を確認してください。
- Is the current routing still correct?
- Has new evidence changed the task type?
- Do we need to load another skill file?
- Is this now verification, review, or final answer?
routing が変わった場合は routingHypothesis を更新し、必要な nextSkillFiles を返してください。

${buildDecisionContract()}

${buildToolCatalog(options?.externalTools)}`;
}

export function buildSupervisorTurnInput(userInput: string, observations: string[]): string {
  if (observations.length === 0) return userInput;
  return [
    userInput,
    '',
    '[これまでに取得したリポジトリ証拠]',
    ...observations
      .slice(-6)
      .map((observation, index) => `Observation ${index + 1}:\n${observation}`),
    '',
    '[停止時の回答要件]',
    '- phase="stop" の場合、finalResponse にユーザー向けの実際の結果を書く。',
    '- 結果を instruction や rationale だけに書かない。',
    '- 証拠系 workflow では、使用した具体的な証拠を含める。',
  ].join('\n');
}

export function buildCodexTurnPrompt(systemPrompt: string, userPrompt: string): string {
  return ['[システム指示]', systemPrompt, '', '[ユーザー入力]', userPrompt].join('\n');
}

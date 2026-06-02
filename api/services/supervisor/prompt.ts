export type SupervisorWorkflow = 'general' | 'evidence_review' | 'code_change' | 'research';

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
    description: '対象が1箇所に限定できる単純なリテラル置換を行う。',
  },
  { name: 'apply_patch', description: '構造的な編集や新規ファイル作成を unified diff で行う。' },
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

function buildToolCatalog(): string {
  return `[Tool catalog]
このセクションだけを worker ツール名、詳細情報、使うべきタイミングの根拠にしてください。
${TOOL_CATALOG.map((tool) => `- ${tool.name}: ${tool.description}`).join('\n')}

[toolCall スキーマ]
${TOOL_CALL_SHAPE}

toolCall.name は必ず Tool catalog にある名前だけを使う。`;
}

function buildDecisionContract(): string {
  return `[Decision JSON 契約]
JSON のみを返してください。markdown のコードブロックで囲まないでください。
必須キー:
- phase: observe | plan | act | verify | report | stop
- workflow: general | evidence_review | code_change | research
- instruction: string
- rationale: string
- finalResponse: string
- expectedEvidence: string[]
- riskLevel: low | medium | high
- toolCall: ${TOOL_CALL_SHAPE}
- terminalState: needs_review | completed | blocked | failed | timed_out | cancelled | needs_human。phase が stop のときだけ指定する。

terminalState は phase="stop" のときだけキーを出してください。phase が stop 以外のときは terminalState キー自体を省略し、null を返してはいけません。
toolCall.name を返す場合は、同じ prompt 内の Tool catalog だけを参照してください。
利用できないツール名を返してはいけません。例: mcp__*, functions.*, exec_command, shell namespace。`;
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

[Round 1: workflow 選択]
必ず1つだけ workflow を選んでください。
- general: リポジトリ証拠を必要としない直接回答や単純なタスク。
- evidence_review: ドキュメントレビュー、コードレビュー、ログ調査、回帰調査、実装計画レビュー、原因調査、またはリポジトリ証拠を引用すべきタスク。
- code_change: リポジトリのファイル変更を伴う実装や修正。
- research: 最新の公開 Web 情報や外部ドキュメント確認が必要なタスク。

Round 1 は基本的に計画を返してください。リポジトリ証拠や Web 証拠を本当に必要としない軽い会話だけ、phase="stop" を許可します。
Round 1 では toolCall を原則 null にしてください。実行手段の選択は Round 2 の Tool catalog に基づいて行います。

${buildDecisionContract()}`;
}

function buildEvidenceReviewContext(): string {
  return `[Workflow SystemContext: evidence_review]
この workflow は、リポジトリ証拠に基づくレビューや調査のためのものです。

必須動作:
- phase="stop" の前に、関連するリポジトリ証拠を取得する。
- ユーザーがファイルパスを示している場合、そのファイルを最初に読む。
- 正確なファイルが不明な場合、候補を探してから読む。
- ログ確認が必要な場合、該当するログソースまたはコマンド出力を確認する。
- Round 2 入力の observations が空の場合、phase="stop" または phase="report" を返してはいけない。Tool catalog から適切な読み取り・検索ツールを1つ選び、toolCall を必ず返す。
- Round 2 入力の observations に証拠がある場合だけ、phase="stop" を返してよい。
- finalResponse には、具体的な指摘と証拠参照を含める。例: ファイルパス、行範囲、event id、コマンド名、ログ識別子。
- phase="stop" の finalResponse は UI に表示されるレビュー結果本文である。レビューの目的、指摘、根拠、残リスクをユーザーがそのまま読める形で書く。
- 「レビューしてください」という指示文だけで答えない。finalResponse はレビュー結果そのものにする。`;
}

function buildCodeChangeContext(): string {
  return `[Workflow SystemContext: code_change]
この workflow は、実装や修正のためのものです。

必須動作:
- 編集前に既存コードを確認する。
- observations が空の場合、phase="stop" または phase="report" を返してはいけない。まず read_file または search_files で対象コードを確認する。
- 既存パターンに合う狭い変更を優先する。
- 単純置換で済む場合だけ置換系の手段を使う。それ以外は patch 系の手段を使う。
- 編集が必要な依頼では、read-only や書き込み不可だと推測して stop してはいけない。必ず replace_content または apply_patch の toolCall を返して編集を試みる。
- replace_content または apply_patch が失敗した場合だけ、その tool result を根拠に書き込み不可・policy block・patch failure を報告してよい。
- 停止前にリポジトリの既存コマンドで検証する。
- finalResponse には変更ファイルと検証結果を要約する。`;
}

function buildResearchContext(): string {
  return `[Workflow SystemContext: research]
この workflow は、最新の外部情報が必要なタスクのためのものです。

必須動作:
- 候補ソースを探し、根拠にするソースは本文まで読む。
- 技術、法律、金融、API 関連の話題では一次情報または公式情報を優先する。
- finalResponse には使用した URL または取得したページタイトルを含める。`;
}

function buildGeneralContext(): string {
  return `[Workflow SystemContext: general]
この workflow は、直接回答や単純なタスクのためのものです。

必須動作:
- リポジトリ証拠や Web 証拠なしで答えられる場合、phase="stop" と finalResponse で完了してよい。
- 証拠が必要だと分かった場合、general 以外の workflow を返し、適切なツールを要求する。`;
}

export function buildRound1SystemPrompt(projectRoot: string): string {
  return buildWorkflowSelectionContext(projectRoot);
}

export function buildRound2SystemPrompt(workflow: SupervisorWorkflow = 'general'): string {
  const workflowContext =
    workflow === 'evidence_review'
      ? buildEvidenceReviewContext()
      : workflow === 'code_change'
        ? buildCodeChangeContext()
        : workflow === 'research'
          ? buildResearchContext()
          : buildGeneralContext();

  return `${buildBaseSystemContext()}

[Round 2: 実行]
Round 1 で選んだ workflow に従い、次の具体的な1手を決めてください。
ユーザー入力は JSON で渡されます。latestUserMessage は元の依頼、round1Decision は workflow 選択結果、todoPlan は run 内の Todo と procedure/context の要約、observations はこれまでの worker ツール実行結果です。
todoPlan がある場合、現在の実行は Todo を順番に完了する前提で進め、未完了 Todo を finalResponse で完了扱いにしないでください。
証拠系 workflow では、observations が空ならユーザー向け回答を作らず、まず toolCall で証拠を取得してください。
証拠系 workflow で observations がある場合は、その証拠だけを根拠に finalResponse をレビュー結果として完成させてください。

${workflowContext}

${buildDecisionContract()}

${buildToolCatalog()}`;
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

import {
  BarChart3,
  BrainCircuit,
  Check,
  CheckCircle2,
  ClipboardList,
  GitCompare,
  Play,
  Sparkles,
} from 'lucide-react';
import { useMemo, useState } from 'react';

type ProjectEvaluationProject = {
  id: string;
  name: string;
  localPath: string;
};

type ProjectEvaluationMockScreenProps = {
  project: ProjectEvaluationProject;
};

type DimensionKey =
  | 'conceptValue'
  | 'implementationCompleteness'
  | 'architectureQuality'
  | 'uiUx'
  | 'testability'
  | 'operability'
  | 'security'
  | 'maintainability'
  | 'extensibility'
  | 'marketCompetitiveness';

type DimensionScore = {
  key: DimensionKey;
  label: string;
  score: number;
  delta: number;
  confidence: number;
  rationale: string;
};

const dimensionScores: DimensionScore[] = [
  {
    key: 'conceptValue',
    label: 'コンセプト価値',
    score: 88,
    delta: 4,
    confidence: 0.82,
    rationale:
      'local-first control plane、Workbench、Queue、run evidence が一つの運用体験としてまとまっており、エージェント作業を「後から検証できる実行」に変える価値が強い。',
  },
  {
    key: 'implementationCompleteness',
    label: '実装完成度',
    score: 71,
    delta: 6,
    confidence: 0.74,
    rationale:
      '主要な Session / Queue / artifact surface は揃っているが、評価結果から改善 Session を生成して Queue に流す一連の体験はまだ mock 段階で、実データ接続が未完了。',
  },
  {
    key: 'architectureQuality',
    label: 'アーキテクチャ',
    score: 78,
    delta: 3,
    confidence: 0.76,
    rationale:
      'NightWorkers の実行台帳、worker tool、Supervisor、UI surface の境界は比較的明確。ただし評価ドメインを追加する場合は nightworkers module から分離し、DB と Queue への接続点だけを絞る必要がある。',
  },
  {
    key: 'uiUx',
    label: 'UI/UX',
    score: 63,
    delta: -2,
    confidence: 0.7,
    rationale:
      'Project 単位の状態把握、履歴比較、改善候補の選択がまだ散らばっている。評価画面では score よりも「なぜその点数か」と「どの軸を改善するか」を素早く読める密度が必要。',
  },
  {
    key: 'testability',
    label: 'テスト容易性',
    score: 73,
    delta: 1,
    confidence: 0.72,
    rationale:
      'repo-native verify は代表ゲートとして使いやすいが、評価軸ごとの改善候補に acceptance criteria と verification commands を紐づける仕組みがまだ薄い。',
  },
  {
    key: 'operability',
    label: '運用性',
    score: 76,
    delta: 3,
    confidence: 0.79,
    rationale:
      'Queue と run event は運用証跡として強い。次は評価履歴、前回差分、未検証事項、改善候補を Project owner が同じ画面で判断できる状態にする必要がある。',
  },
  {
    key: 'security',
    label: 'セキュリティ',
    score: 69,
    delta: 2,
    confidence: 0.66,
    rationale:
      'MCP secret-like input の拒否や local-first 前提は良いが、評価・改善生成が provider に渡す情報の範囲、redaction、保存 payload の確認面はまだ明示不足。',
  },
  {
    key: 'maintainability',
    label: '保守性',
    score: 74,
    delta: 2,
    confidence: 0.73,
    rationale:
      '機能が増えているため、画面単位で巨大化しやすい。評価ドメインでは mock、API client、型、表示コンポーネントを分け、nightworkers shell 側は遷移だけに保つのが重要。',
  },
  {
    key: 'extensibility',
    label: '拡張性',
    score: 72,
    delta: 5,
    confidence: 0.69,
    rationale:
      '評価軸と改善候補を schema 化すれば provider や scoring policy を差し替えられる。現状は mock なので、次に storage contract と export contract を固める余地がある。',
  },
  {
    key: 'marketCompetitiveness',
    label: '市場競争力',
    score: 61,
    delta: 0,
    confidence: 0.58,
    rationale:
      '自律開発の実行管理として差別化余地はあるが、評価から改善実行までのループが見えるデモ体験にならないと、外部から価値を判断しづらい。',
  },
];

export type ProjectEvaluationImprovementIdea = {
  title: string;
  targetKeys: DimensionKey[];
  scoreGain: number;
  summary: string;
  focus: string[];
  implementationInstruction: string;
};

export const projectEvaluationImprovementIdeas: ProjectEvaluationImprovementIdea[] = [
  {
    title: '評価結果から Workbench Session を生成する',
    targetKeys: ['implementationCompleteness', 'operability'],
    scoreGain: 9,
    summary:
      '現状では評価結果が画面上の気づきで止まり、Project owner が「この低い評価軸を改善するために次に何を実行するか」まで移る導線が弱い。評価と実行が分断されたままだと、良い分析が出ても Queue に載る作業へ変換されず、改善サイクルが人手の判断で途切れる。この改善では、選択した評価軸、rationale、期待 score gain を Workbench Session draft に変換し、Queue 投入前に acceptance criteria と verification commands を確認できるようにすることで、評価を実行可能な作業へ確実につなげる。',
    focus: [
      'ProjectEvaluation result -> Task draft の変換',
      'acceptanceCriteria と verificationCommands の保存',
    ],
    implementationInstruction:
      'LLM は ProjectEvaluation の selected dimension、rationale、score delta、期待 score gain を読み取り、NightWorkers Workbench Session の draft を自然言語で作成すること。draft には目的、現状問題、実装方針、acceptance criteria、verification commands、Queue 投入前に人間が確認すべき注意点を含めること。既存 Project Queue へ直接投入せず、まず編集可能な draft として保存すること。',
  },
  {
    title: '評価履歴を差分比較できる表示にする',
    targetKeys: ['uiUx', 'operability'],
    scoreGain: 6,
    summary:
      '現状では最新評価の score と rationale は読めても、前回から何が良くなり、何が悪化し、どの未検証事項が残っているのかを同じ文脈で比較しづらい。評価履歴が時系列の数字だけに見えると、Project owner は改善が本当に効いたのか、次に同じ軸を継続すべきかを判断できない。この改善では、最新評価、前回評価、dimension delta、rationale の変化、未検証項目を差分として並べ、評価履歴を「次の行動を決める材料」として読める状態にする。',
    focus: ['Score - relative date の履歴リスト', 'dimension delta と rationale の比較表示'],
    implementationInstruction:
      'LLM は評価履歴の最新値と前回値を比較し、dimension ごとの score delta、rationale の差分、未検証項目、次に確認すべき evidence を自然言語で整理すること。UI 実装では単なる履歴リストではなく、同じ dimension の前回値と最新値を横並びまたは同一行で比較できる表示にし、悪化・改善・未検証を明確に区別すること。',
  },
  {
    title: '評価軸ごとに改善候補を複数生成する',
    targetKeys: ['conceptValue', 'marketCompetitiveness'],
    scoreGain: 8,
    summary:
      '現状の改善案は評価軸を選んだ後に少数の候補を返すだけで、同じ課題に対する複数の打ち手や優先順位の比較が不足している。特にコンセプト価値や市場競争力のような抽象度の高い軸では、単一の改善案だけでは実装リスク、効果、デモ価値の違いを判断しづらい。この改善では、選択した評価軸ごとに100点へ近づく複数のタスク候補を生成し、score impact、実装コスト、検証しやすさの観点で並べ替えられるようにする。',
    focus: ['dimension selection を generator input にする', '改善候補を score impact 順に並べる'],
    implementationInstruction:
      'LLM は選択された各 evaluation dimension ごとに、少なくとも複数の改善候補を自然言語で生成すること。各候補には、解決する現状問題、期待される score impact、実装範囲、リスク、最小検証方法を含めること。候補は一括実装前提にせず、Project owner が一つずつ選択して Workbench Session 化できる粒度に分けること。',
  },
  {
    title: '評価 provider に渡す evidence boundary を明示する',
    targetKeys: ['security', 'architectureQuality'],
    scoreGain: 5,
    summary:
      '現状では評価 provider がどの情報を読んで判断しているか、逆に secret-like input や不要なローカル情報を渡していないかが UI から分かりづらい。評価品質を上げるには十分な evidence が必要だが、境界が曖昧なまま provider payload が広がると、セキュリティと説明可能性の両方が弱くなる。この改善では、README、package scripts、run evidence、差分、保存済み artifact など評価に渡す情報と渡さない情報を policy として明示し、payload preview と redaction rules を確認できるようにする。',
    focus: ['redaction rules の表示', 'provider payload preview の追加'],
    implementationInstruction:
      'LLM は評価 provider に渡す evidence boundary を自然言語の policy として定義すること。含める情報、除外する情報、redaction する値、payload preview に表示する項目、監査ログに残す項目を分けて記述すること。実装では provider 呼び出し前に payload preview を確認でき、secret-like input は保存・送信されない前提を守ること。',
  },
  {
    title: 'repo-native verify を改善候補に自動付与する',
    targetKeys: ['testability', 'operability'],
    scoreGain: 5,
    summary:
      '現状では改善候補が生成されても、その完了をどのコマンドで確認するかが候補ごとに明確ではない。Project owner や worker が acceptance criteria を読めても、repo-native な verify gate が紐づいていないと、完了判断が主観的になり、Queue 完了後の再評価にもつながりにくい。この改善では、package scripts や既存の検証規約から project ごとの verify command を検出し、改善 task の完了条件として自動的に含めることで、評価改善を検証可能な実行単位にする。',
    focus: ['package scripts から verify candidate を抽出', '失敗時の evidence message を保存'],
    implementationInstruction:
      'LLM は改善候補を Workbench Session draft に変換するとき、対象 Project の package scripts、既存 verify command、関連テストを読み取り、自然言語の verification plan と実行コマンドを提案すること。実装では検出した verify command を候補に保存し、失敗時の evidence message と再試行方針も draft に含めること。',
  },
  {
    title: '評価ドメインを shell から分離する',
    targetKeys: ['maintainability', 'architectureQuality'],
    scoreGain: 6,
    summary:
      '現状の評価画面は NightWorkersShell から開けるようになった段階で、今後 API client、保存履歴、生成結果、Queue 接続が増えると shell 側に評価ドメインの知識が漏れやすい。shell が画面遷移以上の責務を持つと、NightWorkers 本体と Project Evaluation の進化速度が結びつき、保守性と拡張性が落ちるため、ドメイン境界を今の段階で固定することが重要になる。この改善では、NightWorkersShell はプロジェクト選択と遷移だけに限定し、評価画面、型、mock data、将来 API client、生成 payload を project-evaluation domain に閉じる。',
    focus: ['src/modules/project-evaluation の責務固定', 'nightworkers module への逆依存を避ける'],
    implementationInstruction:
      'LLM は Project Evaluation を NightWorkers とは別ドメインとして扱い、UI component、型、mock data、API client、生成 payload builder を src/modules/project-evaluation 配下へ閉じる実装方針を自然言語で記述すること。NightWorkersShell は projectId を渡して画面を開く責務だけにし、評価固有の state や scoring policy を持たせないこと。',
  },
  {
    title: '外部から価値が伝わる sample evaluation を用意する',
    targetKeys: ['marketCompetitiveness', 'conceptValue'],
    scoreGain: 7,
    summary:
      '現状の評価画面は内部の構想としては価値がある一方、初回利用者や外部の観察者には「評価すると何が嬉しいのか」「改善実行後にどう変わるのか」が一目で伝わりにくい。自律開発の実行管理は抽象的に見えやすいため、before/after の評価ストーリーがないと市場価値を判断しづらい。この改善では、sample project evaluation と改善実行後の score/rationale 変化を用意し、評価ループの価値をデモとして説明できる状態にする。',
    focus: ['sample project evaluation の seed', 'before/after score story の作成'],
    implementationInstruction:
      'LLM は初回利用者に価値が伝わる sample evaluation を自然言語で設計すること。sample には baseline score、低い dimension、その理由、選択した改善候補、Queue 実行後の expected delta、再評価時の before/after story を含めること。実装では本物のユーザーデータと混同しない seed/mock として扱い、デモ用途であることを明確にすること。',
  },
  {
    title: '評価軸 schema と保存履歴を versioning する',
    targetKeys: ['extensibility', 'maintainability'],
    scoreGain: 5,
    summary:
      '現状は評価軸が mock data として固定されているため、scoring policy や dimension の定義を変えたときに、過去評価との比較をどう扱うかがまだ決まっていない。評価システムは進化するほど軸名、重み、基準が変わるため、versioning がない保存形式では履歴比較や再評価の信頼性が落ちる。この改善では、schemaVersion、dimension key migration、scoring policy version を保存し、過去評価を壊さずに比較・移行できる形式にする。',
    focus: ['schemaVersion の保存', 'dimension key migration の方針追加'],
    implementationInstruction:
      'LLM は evaluation schema の versioning 方針を自然言語で設計すること。各 evaluation result には schemaVersion、scoringPolicyVersion、dimension key、migration 方針、旧 schema との比較可否を保持すること。実装では新しい評価軸を追加しても過去履歴が消えず、比較できない場合は理由を表示すること。',
  },
  {
    title: 'UI の読み取り密度を評価用に最適化する',
    targetKeys: ['uiUx', 'maintainability'],
    scoreGain: 6,
    summary:
      '現状の評価画面では score は見えるが、Project owner が本当に読みたいのは「なぜその点数なのか」「どのコメントが次の改善判断に効くのか」である。進捗バーや装飾が増えると、評価軸ごとの rationale と改善候補の関係が埋もれ、画面全体の判断速度が落ちる。この改善では、score bar より rationale と差分コメントを優先し、1画面で多くの評価軸、理由、改善候補を読める密度へ最適化する。',
    focus: ['progress bar の削除', 'score badge と大きめ rationale typography'],
    implementationInstruction:
      'LLM は Project Evaluation UI を、装飾より判断密度を優先する業務画面として自然言語で設計すること。score は badge として残し、rationale、delta、未検証項目、改善候補との対応を読みやすくすること。実装ではカードを過剰に大きくせず、長い文章が入っても折り返しと余白が破綻しない layout にすること。',
  },
  {
    title: '改善実行後の再評価ボタンを Queue 完了後に出す',
    targetKeys: ['implementationCompleteness', 'extensibility'],
    scoreGain: 7,
    summary:
      '現状では改善候補を選んだ後、その実行結果が評価 score に反映されたかを同じ流れで確認する導線が弱い。Queue で作業が完了しても再評価が別操作になると、改善が実際に効いたのか、追加対応が必要なのかを判断する evidence が途切れる。この改善では、Queue 実行完了後に同じ評価軸で再評価する CTA を出し、run evidence と evaluation delta を関連付けることで、評価から実行、再評価までの閉じた改善ループを作る。',
    focus: ['run completion -> reevaluate CTA', 'evaluation delta を run evidence に関連付ける'],
    implementationInstruction:
      'LLM は Queue 完了後の再評価フローを自然言語で設計すること。完了した run、対象 improvement idea、元の selected dimension、verification result、再評価で確認すべき観点を紐づけること。実装では Queue entry が completed になった後に reevaluate CTA を出し、再評価結果には元の評価との差分と run evidence への参照を保存すること。',
  },
];

const evaluationHistory = [
  { score: 75, relativeDate: '10min ago', status: 'focused improvements ready' },
  { score: 70, relativeDate: '1d ago', status: 'baseline evaluation' },
  { score: 64, relativeDate: '3d ago', status: 'initial import' },
  { score: 58, relativeDate: '1w ago', status: 'rough scan' },
];

const llmSummary =
  'NightWorkers は Project / Session / Queue / run evidence を中心に、自律開発の作業を後から検証できる形に残せている点が強い。一方で、評価結果から次の改善候補を選び、Workbench Session として実行に接続する流れはまだ弱く、Project owner が「どの軸を優先して100点に近づけるか」を判断できる画面と、選択軸に基づく改善案生成が必要。';

const defaultSelectedKeys: DimensionKey[] = [
  'uiUx',
  'marketCompetitiveness',
  'implementationCompleteness',
];

export function ProjectEvaluationImprovementInstructionField({
  idea,
}: {
  idea: ProjectEvaluationImprovementIdea;
}) {
  return (
    <input
      data-llm-implementation-instruction="project-evaluation"
      data-title={idea.title}
      name="projectEvaluationLlmImplementationInstruction"
      type="hidden"
      value={idea.implementationInstruction}
    />
  );
}

export function ProjectEvaluationMockScreen({ project }: ProjectEvaluationMockScreenProps) {
  const [selectedKeys, setSelectedKeys] = useState<Set<DimensionKey>>(
    () => new Set(defaultSelectedKeys)
  );
  const [generatedKeys, setGeneratedKeys] = useState<Set<DimensionKey> | null>(null);
  const [selectedIdeaTitles, setSelectedIdeaTitles] = useState<Set<string>>(() => new Set());
  const generatedDimensionLabels = useMemo(
    () =>
      generatedKeys
        ? dimensionScores
            .filter((dimension) => generatedKeys.has(dimension.key))
            .map((dimension) => dimension.label)
        : [],
    [generatedKeys]
  );
  const generatedIdeas = useMemo(
    () =>
      generatedKeys
        ? projectEvaluationImprovementIdeas.filter((idea) =>
            idea.targetKeys.some((key) => generatedKeys.has(key))
          )
        : [],
    [generatedKeys]
  );
  const selectedCount = selectedKeys.size;
  const selectedDimensionLabels = useMemo(
    () =>
      dimensionScores
        .filter((dimension) => selectedKeys.has(dimension.key))
        .map((dimension) => dimension.label),
    [selectedKeys]
  );
  const scoreDelta = evaluationHistory[0].score - evaluationHistory[1].score;

  const toggleDimension = (key: DimensionKey) => {
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const selectLowest = () => {
    setSelectedKeys(
      new Set(
        dimensionScores
          .slice()
          .sort((a, b) => a.score - b.score)
          .slice(0, 3)
          .map((dimension) => dimension.key)
      )
    );
  };
  const generateImprovements = () => {
    setGeneratedKeys(new Set(selectedKeys));
    setSelectedIdeaTitles(new Set());
  };

  const toggleImprovementIdea = (title: string) => {
    setSelectedIdeaTitles((current) => {
      const next = new Set(current);
      if (next.has(title)) {
        next.delete(title);
      } else {
        next.add(title);
      }
      return next;
    });
  };

  return (
    <main className="flex h-full min-h-0 flex-col bg-[var(--nw-background)] text-[var(--nw-text)]">
      <header className="flex h-12 shrink-0 items-center justify-between border-[var(--nw-border)] border-b bg-[var(--nw-panel)] px-4">
        <div className="min-w-0">
          <div className="truncate font-semibold text-[var(--nw-text)] text-sm">{project.name}</div>
          <div className="truncate text-[var(--nw-subtle-text)] text-xs">{project.localPath}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--nw-strong-border)] bg-[var(--nw-surface-soft)] px-2.5 text-[var(--nw-text)] text-xs">
            <CheckCircle2 className="h-3.5 w-3.5" />
            mock ready
          </span>
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--nw-strong-border)] bg-[var(--nw-surface-soft)] px-3 text-[var(--nw-text)] text-xs transition hover:bg-[var(--nw-surface)]"
            type="button"
          >
            <Play className="h-4 w-4" />
            評価を実行
          </button>
        </div>
      </header>

      <div className="nightworkers-scrollbar min-h-0 flex-1 overflow-auto">
        <div className="min-w-[1120px] space-y-4 p-4">
          <section className="rounded-md border border-[var(--nw-border)] bg-[var(--nw-panel)] p-5 shadow-sm">
            <div className="grid grid-cols-[1fr_220px] items-start gap-5">
              <div className="min-w-0">
                <div className="font-semibold text-[var(--nw-text)] text-xl tracking-normal">
                  LLM総評
                </div>
                <p className="mt-2 text-[15px] text-[var(--nw-muted-text)] leading-7">
                  {llmSummary}
                </p>
              </div>
              <div className="flex min-h-32 shrink-0 flex-col items-center justify-center rounded-md border border-[var(--nw-strong-border)] bg-[var(--nw-surface-soft)] px-4 py-4 text-center">
                <div className="font-semibold text-[var(--nw-primary)] text-xs">Overall score</div>
                <div className="mt-2 flex items-baseline justify-center gap-1 text-5xl font-semibold text-[var(--nw-text)]">
                  {evaluationHistory[0].score}
                  <span className="text-xl text-[var(--nw-subtle-text)]">/ 100</span>
                </div>
                <div className="mt-1 text-[var(--nw-primary)] text-xs">
                  +{scoreDelta} from previous
                </div>
              </div>
            </div>
          </section>

          <section className="grid grid-cols-[260px_minmax(0,1fr)] gap-4">
            <aside className="h-full rounded-md border border-[var(--nw-border)] bg-[var(--nw-panel)] shadow-sm">
              <div className="flex h-10 items-center gap-2 border-[var(--nw-border)] border-b px-3 font-semibold text-[var(--nw-muted-text)] text-xs uppercase">
                <GitCompare className="h-4 w-4 text-[var(--nw-subtle-text)]" />
                History
              </div>
              <div className="space-y-1 p-2">
                {evaluationHistory.map((item, index) => (
                  <button
                    className={`flex h-9 w-full items-center justify-between rounded-md border px-3 text-left transition ${
                      index === 0
                        ? 'border-[var(--nw-primary)] bg-[var(--nw-surface-soft)] text-[var(--nw-text)]'
                        : 'border-transparent bg-[var(--nw-panel)] text-[var(--nw-muted-text)] hover:border-[var(--nw-border)]'
                    }`}
                    key={`${item.score}-${item.relativeDate}`}
                    type="button"
                  >
                    <span className="font-semibold text-sm">{item.score}</span>
                    <span className="text-[var(--nw-subtle-text)] text-xs">
                      - {item.relativeDate}
                    </span>
                  </button>
                ))}
              </div>
            </aside>

            <section className="rounded-md border border-[var(--nw-border)] bg-[var(--nw-panel)] shadow-sm">
              <div className="flex min-h-12 items-center justify-between gap-3 border-[var(--nw-border)] border-b px-3 py-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-semibold text-[var(--nw-muted-text)] text-xs uppercase">
                    <BarChart3 className="h-4 w-4 text-[var(--nw-primary)]" />
                    Round 1 / 評価軸を選ぶ
                  </div>
                  <div className="mt-1 truncate text-[var(--nw-subtle-text)] text-xs">
                    {selectedCount > 0
                      ? `${selectedCount} axes selected: ${selectedDimensionLabels.join(' / ')}`
                      : '改善案を生成する評価軸を選択してください。'}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    className="rounded-md border border-[var(--nw-border)] px-2.5 py-1 text-[var(--nw-muted-text)] text-xs hover:border-[var(--nw-primary)]"
                    onClick={selectLowest}
                    type="button"
                  >
                    下位3軸
                  </button>
                  <button
                    className="rounded-md border border-[var(--nw-border)] px-2.5 py-1 text-[var(--nw-muted-text)] text-xs hover:border-[var(--nw-primary)]"
                    onClick={() =>
                      setSelectedKeys(new Set(dimensionScores.map((item) => item.key)))
                    }
                    type="button"
                  >
                    すべて
                  </button>
                  <button
                    className="rounded-md border border-[var(--nw-border)] px-2.5 py-1 text-[var(--nw-muted-text)] text-xs hover:border-[var(--nw-primary)]"
                    onClick={() => setSelectedKeys(new Set())}
                    type="button"
                  >
                    解除
                  </button>
                </div>
              </div>
              <div className="divide-y divide-[var(--nw-border)]">
                {dimensionScores.map((dimension) => {
                  const selected = selectedKeys.has(dimension.key);
                  return (
                    <button
                      aria-pressed={selected}
                      className={`grid w-full grid-cols-[44px_1fr_104px] gap-3 px-4 py-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nw-primary)] ${
                        selected
                          ? 'bg-[var(--nw-surface-soft)]'
                          : 'bg-[var(--nw-panel)] hover:bg-[var(--nw-surface)]'
                      }`}
                      key={dimension.key}
                      onClick={() => toggleDimension(dimension.key)}
                      type="button"
                    >
                      <span aria-hidden="true" className="flex items-start justify-center pt-1.5">
                        <Check
                          className={`h-5 w-5 transition ${
                            selected ? 'text-[var(--nw-primary)]' : 'text-transparent'
                          }`}
                          strokeWidth={3}
                        />
                      </span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-2">
                          <span className="font-semibold text-[var(--nw-text)] text-base">
                            {dimension.label}
                          </span>
                          <span className="text-[var(--nw-subtle-text)] text-xs">
                            confidence {Math.round(dimension.confidence * 100)}%
                          </span>
                        </span>
                        <span className="mt-1 block text-[var(--nw-muted-text)] text-[15px] leading-7">
                          {dimension.rationale}
                        </span>
                      </span>
                      <span className="flex flex-col items-end justify-start">
                        <span className="text-3xl font-semibold text-[var(--nw-text)]">
                          {dimension.score}
                        </span>
                        <span
                          className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] ${
                            dimension.delta >= 0
                              ? 'bg-[var(--nw-surface-soft)] text-[var(--nw-primary)]'
                              : 'bg-[var(--nw-surface-soft)] text-[var(--nw-danger)]'
                          }`}
                        >
                          {dimension.delta >= 0 ? '+' : ''}
                          {dimension.delta}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          </section>

          <section className="rounded-md border border-[var(--nw-border)] bg-[var(--nw-panel)] shadow-sm">
            <div className="flex min-h-12 items-center justify-between gap-3 border-[var(--nw-border)] border-b px-3 py-2">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2 font-semibold text-[var(--nw-muted-text)] text-xs uppercase">
                  <Sparkles className="h-4 w-4 text-[var(--nw-primary)]" />
                  Round 2 / 選択軸から改善案を生成
                </div>
                <div className="mt-1 truncate text-[var(--nw-subtle-text)] text-xs">
                  {generatedKeys
                    ? `generated for: ${generatedDimensionLabels.join(' / ')}`
                    : 'Round 1 の選択を使って、100点に近づくための改善案を生成します。'}
                </div>
              </div>
              <button
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--nw-strong-border)] bg-[var(--nw-surface-soft)] px-3 font-medium text-[var(--nw-text)] text-xs transition hover:bg-[var(--nw-surface)] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={selectedKeys.size === 0}
                onClick={generateImprovements}
                type="button"
              >
                <BrainCircuit className="h-3.5 w-3.5" />
                改善案を生成
              </button>
            </div>
            {!generatedKeys ? (
              <div className="p-6 text-center text-[var(--nw-subtle-text)] text-sm">
                まだ改善案は生成されていません。Round 1 で軸を選び、改善案を生成してください。
              </div>
            ) : generatedKeys.size === 0 ? (
              <div className="p-6 text-center text-[var(--nw-subtle-text)] text-sm">
                生成対象の軸がありません。Round 1 で少なくとも1つ選択してください。
              </div>
            ) : (
              <>
                <div className="flex min-h-10 items-center justify-between border-[var(--nw-border)] border-b px-3 py-2">
                  <span className="text-[var(--nw-subtle-text)] text-xs">
                    {generatedIdeas.length} improvement tasks / {selectedIdeaTitles.size} selected
                  </span>
                  <button
                    className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs transition disabled:cursor-not-allowed disabled:opacity-50 ${
                      selectedIdeaTitles.size > 0
                        ? 'border-[var(--nw-strong-border)] bg-[var(--nw-surface-soft)] text-[var(--nw-text)] hover:bg-[var(--nw-surface)]'
                        : 'border-[var(--nw-border)] text-[var(--nw-muted-text)]'
                    }`}
                    disabled={selectedIdeaTitles.size === 0}
                    type="button"
                  >
                    <ClipboardList className="h-3.5 w-3.5" />
                    選択候補を Task 化
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3 p-3">
                  {generatedIdeas.map((idea) => {
                    const selected = selectedIdeaTitles.has(idea.title);
                    return (
                      <div className="flex min-h-72" key={idea.title}>
                        <ProjectEvaluationImprovementInstructionField idea={idea} />
                        <button
                          aria-pressed={selected}
                          className={`flex min-h-72 w-full flex-col rounded-md border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nw-primary)] ${
                            selected
                              ? 'border-[var(--nw-primary)] bg-[var(--nw-surface-soft)]'
                              : 'border-[var(--nw-border)] bg-[var(--nw-surface)] hover:border-[var(--nw-primary)]'
                          }`}
                          onClick={() => toggleImprovementIdea(idea.title)}
                          type="button"
                        >
                          <span className="flex items-start justify-between gap-3">
                            <span className="flex flex-wrap gap-1.5">
                              {idea.targetKeys.map((key) => {
                                const dimension = dimensionScores.find((item) => item.key === key);
                                const active = generatedKeys.has(key);
                                return (
                                  <span
                                    className={`rounded-full border px-2 py-0.5 text-[11px] ${
                                      active
                                        ? 'border-[var(--nw-primary)] bg-[var(--nw-surface-soft)] text-[var(--nw-primary)]'
                                        : 'border-[var(--nw-border)] text-[var(--nw-subtle-text)]'
                                    }`}
                                    key={key}
                                  >
                                    {dimension?.label ?? key}
                                  </span>
                                );
                              })}
                            </span>
                            <Check
                              aria-hidden="true"
                              className={`h-5 w-5 shrink-0 transition ${
                                selected ? 'text-[var(--nw-primary)]' : 'text-transparent'
                              }`}
                              strokeWidth={3}
                            />
                          </span>
                          <span className="mt-3 font-semibold text-[var(--nw-text)] text-base">
                            {idea.title}
                          </span>
                          <span className="mt-2 block text-[var(--nw-muted-text)] text-sm leading-6">
                            {idea.summary}
                          </span>
                          <span className="mt-3 space-y-1.5 text-[var(--nw-muted-text)] text-sm">
                            {idea.focus.map((item) => (
                              <span className="flex gap-2" key={item}>
                                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--nw-primary)]" />
                                <span>{item}</span>
                              </span>
                            ))}
                          </span>
                          <span className="mt-auto pt-4 font-medium text-[var(--nw-primary)] text-sm">
                            expected score gain +{idea.scoreGain}
                          </span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

# Code Edit Mode

## Use When

ユーザーが source behavior の変更、機能追加、バグ修正を求めているときに使う。

## Required Behavior

- 編集前に既存コードを確認する。
- observations が空の場合、最終回答へ進まず、対象パスが分かっているならまず read_file で対象コードを確認する。search_files は対象パスが不明、または横断検索が必要な場合だけ使う。
- ファイルを編集する前に、対象ファイルまたは直接関係する既存ファイルを読む。新規ファイル作成では、配置先の route / registry / sibling / style / test pattern を先に確認する。
- rg --files や ls は探索であり、編集対象の読了 evidence ではない。読んだ内容に基づかない blind edit を避ける。
- 広い shell 出力を避ける。対象ファイルは `read_file` の line range、横断検索は `search_files` または path/glob/context を絞った `rg`、差分確認は `git_status` / `git_diff` summary / path-scoped diff を優先する。
- 不具合原因が未確認なら、先に investigation / evidence の rule を読む。
- read-only や書き込み不可だと推測して最終回答へ進んではいけない。
- 空の Project root は有効な作業対象として扱う。空であることは新規作成やテンプレート取り込みの前提であり、作業不能の根拠ではない。
- 指定がない新規 Web / API / Hono アプリは、blank から作らず import_project で source=starter, stack=hono の既定 SQLite variant を取り込む。ユーザーが blank や別 stack を明示した場合だけ別経路にする。
- DB 指定がある場合は postgres / pgvector / turso / cloudflare など該当 variant を選ぶ。RAG、ナレッジベース検索、embedding を使う文書検索、agentic search が主要要件なら hono stack で variant=rag を選ぶ。SSR / SSG 指定があり DB/RAG variant がない場合は該当 overlay を指定する。DB/RAG variant と overlay を1回の import_project で合成しない。
- stack=python は、ユーザーが Python / FastAPI を明示した場合、または ML 活用や大きな数学的・科学技術計算が主要要件に含まれる場合に使う。
- 外部ディレクトリテンプレートのコピー、外部リポジトリーの clone や fork、または複数ステップの検証を伴う作業は major_code_edit に切り替える。
- Project root 外のコピー元は、ユーザー許可により safetyPolicy.externalAllowedPaths に含まれている場合だけ読む。未許可なら完了扱いにせず許可を求める。
- import_project を Project import の単一入口として使う。新規雛形は source=starter と stack/variant、任意の外部 Git repository は source=git と repoUrl を渡す。
- import_project で扱える取り込みは run_command git clone で代替しない。
- 許可済み外部テンプレートを取り込む場合は copy_directory を優先する。
- テンプレート取り込みは import_project / copy_directory だけで完了扱いにしない。major_code_edit の TodoList に manifest inspection と manifest-based verification を含める。
- major_code_edit の todo_list operation=replace では、各 Todo に taskType を明示する。確認・調査だけの Todo は inspection または investigation、実装変更は implementation / code_edit / scaffold、局所検証は focused_verification にする。
- TodoList pane がユーザーに見える進捗の source of truth なので、2 手以上の調査・編集・検証では最初の実質作業前に既存 Todo を start するか、作業内容と合わない場合だけ operation=replace で追跡可能な TodoList にする。
- todo_list operation=list は診断専用であり、進捗更新として扱わない。作業段階を進める場合は start/done/block/fail を使う。
- operation=replace に広域 verification / review / closeout Todo を含めない。NightWorkers が品質ゲートと完了報告の固定ゲートを追加する。
- import_project 後は postImport.gitInitialization、postImport.llmContext があればそれ、あわせて postImport.manifest、postImport.initialization の実出力を先に使う。payload が欠落している、または修復対象の失敗がある場合を除き、LLM_CONTEXT.md や package.json の再読込、install 再実行をしない。
- copy_directory 後は package.json や pyproject.toml を読み、scripts / tool config から build / lint / typecheck / test / verify / pytest / ruff / pyright など実行可能な検証を選び、run_verification で実行する。
- CLI コマンドは run_command / run_verification 経由で、command policy が許可する単一コマンドだけ使う。
- CLI コマンドは実行前に出力量を絞る。多行出力が予想される場合は、path、format、count、context、test target を指定してから実行する。
- 既存ファイルの単純な変更では replace_content を第一選択にする。
- 新規ファイル作成、複数ファイル変更、構造的な編集では apply_patch を使う。
- 必ず replace_content または apply_patch の toolCall を返して編集を試みる。

## Stop Conditions

- 編集と検証が完了した場合だけ summarize へ進む。
- 未完了 Todo が残っている場合は、done/block/fail のいずれかで整理するまで finalize_answer へ進まない。
- observations の worker tool 結果だけを根拠に、追加作業が不要な場合だけ最終回答へ進む。

## Report Contract

- finalize_answer.message には変更ファイルと検証結果を要約する。

## Avoid

- 編集ツール結果が observations に無いまま、作成済み・編集済み・確認済みとして完了報告しない。
- Codex 自身の作業や別経路のファイル変更を、worker tool の実行結果として扱わない。

# @gxp/design-system

![Coverage](https://img.shields.io/badge/coverage-95%25+-brightgreen)

モダンなB2Bアプリケーション向けに構築された、堅牢なエンタープライズグレードのReactコンポーネントライブラリです。**Tailwind CSS**、**Radix UI**、**TypeScript**をベースにしており、アクセシビリティに配慮した、テーマ適用可能で高性能なコンポーネント群を提供します。

> 📖 **[Storybook ドキュメント](http://localhost:6006)** — `bun storybook` でローカル起動できます

## ✨ 主な特徴

- **エンタープライズコンポーネント**: 複雑でデータリッチなインターフェース向けに設計された45種類以上の高品質コンポーネント。
- **アクセシビリティ優先**: [Radix UI](https://www.radix-ui.com/)プリミティブをベースに構築し、WAI-ARIAへの完全準拠を保証。
- **テーマエンジン**: プロフェッショナルな11種類の組み込みテーマ（ライト、ダーク、Tokyo Nightなど）を提供し、CSS変数による詳細なカスタマイズが可能。
- **型安全性**: TypeScriptで記述されており、完全な型定義による優れた開発体験を提供。
- **モダンスタック**: Vite, Biome, Vitest, tailwind-mergeで構築。ランタイムのジェネリックスタイルゼロ（Tailwind v4対応）。

## ⚡ クイックスタート

最短3ステップでセットアップ完了！

```bash
# 1. インストール（ローカルパス指定）
bun add ../gxp-designSystem

# 2. i18n依存関係のインストール（i18nを使用する場合のみ）
bun add i18next react-i18next
```

```tsx
// 3. アプリケーションで使用
import '@gxp/design-system/styles';
import { Button, Card, CalendarProvider } from '@gxp/design-system';
// import './i18n'; // i18n設定ファイル（i18nを使用する場合）

export function App() {
  return (
    <CalendarProvider>
      <Card title="はじめよう">
        <Button variant="primary">ボタン</Button>
      </Card>
    </CalendarProvider>
  );
}
```



## 🚀 インストール

本デザインシステムはnpmレジストリには公開されていません。
利用するプロジェクトと同じ階層に配置し、ローカルパスとして依存関係に追加して利用します。

**ディレクトリ構成例:**
```text
/workspace
  ├── your-app/        # 利用側のアプリケーション
  └── gxp-designSystem/ # 本デザインシステム
```

**インストール:**

プロジェクトのディレクトリで以下のコマンドを実行します：

```bash
bun add ../gxp-designSystem
```

これにより、`package.json` には以下のように追加されます：

```json
"dependencies": {
  "@gxp/design-system": "file:../gxp-designSystem"
}
```

## 🛠️ 導入方法

### 1. スタイルのインポート

アプリケーションのエントリーポイント（例: `src/main.tsx` や `src/App.tsx`）で、コンパイル済みのCSSファイルをインポートしてください。

```typescript
import '@gxp/design-system/styles';
```

または、CSS ModulesやSassを使用している場合は、グローバルスタイルとしてインポートしてください。
また、`@gxp/design-system/styles` は `dist/design-system.css` を指しています。

### 2. Tailwind CSSの設定

本ライブラリは **Tailwind CSS v4** に対応しています。
アプリケーション側でデザインシステムのスタイルを利用するには、`tailwind-preset` を設定する必要があります。
これは、デザインシステムで定義されたカラーパレット（`primary`, `secondary` など）やアニメーションを利用可能にします。

`tailwind.config.ts` (または `js`, `cjs`) にパッケージのコンテンツパスとプリセットを追加してください。
プリセットを読み込むことで、デザインシステムと全く同じテーマ設定が適用されます。

```typescript
// tailwind.config.ts
import type { Config } from 'tailwindcss';
import { designSystemPreset } from '@gxp/design-system/tailwind-preset';

export default {
  content: [
    './src/**/*.{ts,tsx}',
    './node_modules/@gxp/design-system/dist/**/*.{js,mjs}'
  ],
  presets: [designSystemPreset],
} satisfies Config;
```

### 3. i18n (多言語化) の設定 [オプショナル]

本ライブラリは i18n なしでも動作します。各コンポーネントはデフォルトで英語ラベルを使用し、プロップスで上書き可能です。

#### i18nなしで使用する場合

コンポーネントのラベルはプロップスで直接指定できます：

```tsx
// 例: AsyncDataWrapper
<AsyncDataWrapper
  loadingText="読み込み中..."
  noDataText="データがありません"
  refreshText="更新"
  // ...
/>

// 例: ConfirmModal
<ConfirmModal
  confirmText="確認"
  cancelText="キャンセル"
  // ...
/>

// 例: ActionButton
<SaveButton label="保存" />
<DeleteButton label="削除" />
<CancelButton label="キャンセル" />
```

#### i18nを使用する場合（推奨）

多言語対応が必要なアプリケーションでは、`react-i18next` を設定し、`LanguageSelector` コンポーネントを使用できます。

```tsx
// カスタム言語リストの例
const myLanguages = [
  { value: 'ja', label: '日本語' },
  { value: 'en', label: 'English' },
  { value: 'zh', label: '中文' },
];

<LanguageSelector languages={myLanguages} />
```

**インストール:**

```bash
bun add i18next react-i18next
```

**設定例 (`src/i18n.ts`):**

```typescript
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

i18n
  .use(initReactI18next)
  .init({
    lng: 'ja',
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
    resources: {
      ja: {
        translation: {
          // アプリケーション固有の翻訳
        }
      }
    }
  });

export default i18n;
```

> **Note**: `DateFormat` と `DateDisplay` コンポーネントは `locale` プロップスでロケールを指定できます。指定がない場合は `navigator.language` を使用します。


### 4. アプリケーションの構築 (プロバイダーの設定)

カレンダー設定などを有効にするために、`CalendarProvider` でアプリケーション（または該当セクション）をラップすることを推奨します。

```tsx
import { 
  Button, 
  Card, 
  CalendarProvider, // 追加
} from '@gxp/design-system';
import './i18n'; // i18n設定のインポート

export function App() {
  return (
    <CalendarProvider defaultPreferLocalCalendar={true}>
      <div className="p-10">
        <Card title="Welcome">
          <p className="mb-4">これはB2B対応のコンポーネントです。</p>
          <Button variant="primary">はじめる</Button>
        </Card>
      </div>
    </CalendarProvider>
  );
}
```

## 📚 コンポーネント一覧

本ライブラリには、エンタープライズSaaSアプリケーションに最適化された包括的なセットが含まれています。

### 入力 & フォーム
- **基本**: `Button`, `Input`, `Textarea`, `Checkbox`, `Switch`, `Label`
- **選択**: `Select`, `SearchableSelect`, `EditableSelect`, `OptionButtonGroup`
- **高度な入力**: `Form`, `ScaleInput`, `SimpleSearchInput`, `SelectableTextInput`

### データ表示
- **ビジュアル**: `Avatar`, `Badge`, `ImageViewer`, `Skeleton`
- **データ**: `MiniTable`, `Pagination`, `NumberFormat`, `DateDisplay`, `DateFormat`

### フィードバック & オーバーレイ
- **フィードバック**: `NotificationToast`, `Spinner`, `ErrorState`, `Tooltip`
- **オーバーレイ**: `Modal`, `ConfirmModal`, `Drawer`, `Popover`, `KeypadModal`
- **折りたたみ**: `Collapsible`

### レイアウト & ナビゲーション
- **構造**: `Card`, `Separator`, `ScrollArea`, `ContentHeader`
- **ナビゲーション**: `Tabs`, `NavigationStepper`, `TreeMenu`, `ViewSwitcher`, `DropdownMenu`

### ユーティリティ
- `AdaptiveText`, `AsyncDataWrapper`, `Calculator`, `ChatDock`, `CopyClipButton`, `LanguageSelector`

## 📖 機能詳細とユースケース

### DateFormat と CalendarProvider

`DateFormat` コンポーネントは、`CalendarProvider` の設定に基づいて日付を表示します。

- **`secondaryCalendar`**: 'japanese' (和暦), 'buddhist' (仏暦) などを併記します。
- **`preferLocalCalendar`**: ロケールに基づいて自動的に適切な暦（例: `ja-JP` なら和暦）を優先表示します。

```tsx
const Settings = () => {
  const { setPreferLocalCalendar, setSecondaryCalendar } = useCalendarSettings();
  
  return (
    <div>
      <Switch onCheckedChange={setPreferLocalCalendar}>
        ローカル暦を優先
      </Switch>
    </div>
  );
};
```

### AsyncDataWrapper

非同期データのロード状態、エラー状態、空の状態をハンドリングします。今回のアップデートで `useTranslation` に対応しました。

```tsx
<AsyncDataWrapper
  isLoading={isLoading}
  error={error}
  isEmpty={data.length === 0}
  refetch={refetch}
  emptyMessage="表示するデータが見つかりません" // i18nキーまたは直接テキスト
>
  <MyDataList data={data} />
</AsyncDataWrapper>
```

## 🎨 テーマ

システムには複数の設定済みテーマが付属しています。`<html>` または `<body>` タグに `data-theme` 属性を設定することでテーマを切り替えることができます。

| テーマ名 | 説明 |
|------------|-------------|
| `light` | クリーンで高コントラストなライトテーマ（デフォルト） |
| `dark` | プロフェッショナルなダークモード |
| `tokyonight` | 深みのあるスレート/パープル基調のテーマ |
| `leafmint` | 落ち着いた緑と自然なトーン |
| `sunshineOrange` | 暖かみのあるエネルギッシュなテーマ |
| `eclipse` | ダークブルーを基調とした落ち着いたテーマ |
| `macosclassic` | クラシックなOSスタイルを模したテーマ |
| `fire` | 赤とオレンジを基調とした情熱的なテーマ |
| `classicterminal` | 緑色の文字が特徴的なレトロターミナル風テーマ |
| `sakurabloom` | 桜色をアクセントにした優しいテーマ |
| `lattecream` | 柔らかいブラウンとクリーム色のテーマ |

### カスタムテーマの追加

新しいプロジェクトで独自のテーマを追加するには、以下の手順で行います。

1. **CSSでテーマ変数を定義**:
   `src/styles/themes.css` を参考に、`data-theme="your-theme-name"` 属性を持つセレクタを作成し、各CSS変数を定義します。

   ```css
   /* 例: アプリケーション側のCSS */
   :root[data-theme="my-app-theme"] {
     --primary: hsl(200 100% 50%);
     --primary-foreground: hsl(0 0% 100%);
     /* ...必要な変数を定義 */
   }
   ```

2. **テーマの適用**:
   アプリケーションのルート要素（`html` や `body`）に `data-theme="my-app-theme"` を設定します。
   `ThemeName` 型は任意の文字列を受け入れられるように拡張されているため、TypeScriptのエラーなしで使用できます。

## 💻 開発

### セットアップ

```bash
# 依存関係のインストール
bun install
```

### コマンド

| コマンド | 説明 |
|---------|-------------|
| `bun storybook` | コンポーネントドキュメントサーバー (Storybook) を起動 |
| `bun build` | 本番用ライブラリのビルド (ESM & CJS) |
| `bun test` | Vitestによるユニットテストの実行 |
| `bun lint` | Biomeによるリントとフォーマット |
| `bun type-check` | TypeScriptの型チェック実行 |

### DockerでStorybookを起動

Dockerを使用して、環境に依存せずStorybookを起動することができます。

```bash
# コンテナのビルドと起動
docker compose up --build
```

起動後、[http://localhost:6006](http://localhost:6006) にアクセスしてください。
ホットリロード（ファイルの変更検知）も有効になっています。

## 🧪 テストと品質管理

本ライブラリは高い信頼性を維持するため、厳格なテスト基準を設けています。

### テストカバレッジについて

**現在、95%以上のテストカバレッジを維持しています（2026-01-05時点）。**
本プロジェクトでは、コードの品質と堅牢性を保証するため、この基準を下回らないよう開発を進めてください。

> [!NOTE]
> カバレッジプロバイダーには `v8` ではなく `istanbul` を採用しています。これは大規模なプロジェクトでの V8 プロバイダーのハングアップ問題を回避し、CI/CD環境での安定性を確保するためです。開発時は `bun test` を使用してください。

```bash
# カバレッジレポートの生成
bun test run --coverage
```

| 項目 (Metric) | 目標 (Threshold) | 現在 (Current) | ステータス |
| :--- | :--- | :--- | :--- |
| **Statements** | 90% | 95.94% | ✅ Passing |
| **Branches** | 90% | 90.22% | ✅ Passing |
| **Functions** | 90% | 96.11% | ✅ Passing |
| **Lines** | 90% | 97.31% | ✅ Passing |

### Git Hooks (Husky)

品質を担保するため、`husky` を使用してコミットおよびプッシュ時に自動チェックを行っています。

- **pre-push**: テスト (`bun test run`) が成功しない限り、リモートリポジトリへのプッシュは拒否されます。

## ❓ トラブルシューティング

### "Invalid hook call" エラーが出る場合

ローカルパス (`file:../`) でインストールした場合、アプリケーション側とデザインシステム側で異なる `React` インスタンスが参照され、エラーになることがあります。
その場合、アプリケーション側の `vite.config.ts` で `resolve.alias` を設定し、強制的にアプリケーション側の `node_modules` の React を使用するよう指定してください。

```typescript
// vite.config.ts (利用側のアプリケーション)
import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  // ...
  resolve: {
    alias: {
      'react': path.resolve(__dirname, './node_modules/react'),
      'react-dom': path.resolve(__dirname, './node_modules/react-dom'),
    },
  },
});
```

## 📄 ライセンス

MIT © GXP

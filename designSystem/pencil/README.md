# Pencil.dev 実装ガイドライン

このディレクトリには、UIコンポーネントの設計と実装を同期させるための **Pencil.dev (.penファイル)** 関連の資産が格納されています。FigmaやStorybookの代替として活用するためのルールを以下にまとめます。

## 1. ファイル構成と役割

- **`pencilSchema.ts`**: Pencil.dev (v2.9) の公式TypeScript型定義。
- **`designSystem.pen`**: デザインシステム全体の視覚的定義ファイル。Pencilエディタで直接閲覧・編集可能です。
- **`index.tsx`**: 全コンポーネントを包括したプレビュー用カタログ。`DesignSystemPreview` をエクスポートします。
- **`generatedVariants.ts`**: `.pen` から自動生成されるバリアント一覧（手編集禁止）。
- **`scripts/sync-variants.mjs`**: `.pen` から `generatedVariants.ts` を生成するスクリプト。

## 2. `.pen` ファイルの基本構造 (Version 2.9)

`.pen` ファイルは JSON 形式です。以下の構造を厳守してください。

```json
{
  "version": "2.9",
  "children": [
    {
      "id": "root-frame",
      "type": "frame",
      "x": 0,
      "y": 0,
      "width": 1000,
      "height": 1000,
      "fill": { "type": "solid", "color": "#FFFFFF" },
      "children": [
        /* ここにコンポーネントを配置 */
      ]
    }
  ]
}
```

## 3. 主要なプロパティの書き方

| プロパティ | 形式 | 注意点 |
| :--- | :--- | :--- |
| `version` | `"2.9"` (String) | **数値ではなく文字列**で指定してください。 |
| `fill` | Object | `"#FFFFFF"` などの直接指定ではなく、`{ "type": "solid", "color": "#RRGGBB" }` 形式が推奨されます。 |
| `text.content` | String | テキストの内容は `text` ではなく **`content`** プロパティに記述します。 |
| `layout` | Enum | `vertical`, `horizontal`, `none` を指定して Flexbox 的な配置が可能です。 |

## 4. 実装のステップ

1. **コンポーネントの実装**: `designSystem/src/components/ui/` に TSX を作成。
2. **プレビューの更新**: `designSystem/pencil/index.tsx` にマウント。
3. **Pencil定義の追加**: `designSystem/pencil/designSystem.pen` に該当コンポーネントの図形定義を追加。
   - `id` はコード上のコンポーネント名と一致させるか、`metadata` に情報を付与。

## 5. 注意事項

- **JSONコメント禁止**: `.pen` ファイル (JSON) 内に `//` や `/* */` を含めると読み込みエラーになります。
- **座標指定**: `layout` が `none` の場合、`x`, `y` 座標を適切に設定しないと要素が重なります。

## 6. バリアント一覧のメンテナンス

`.pen` に変更を入れたら、以下のコマンドでバリアント一覧を再生成してください。

```bash
pnpm -C designSystem pencil:variants
```

`designSystem` の build ではこの生成処理が自動実行されます。

## 7. Storybook との併用運用

`designSystem` では Storybook 10 系を利用します。`.pen` との同期を崩さないため、起動時に必ずバリアント同期を実行します。

```bash
pnpm -C designSystem storybook
```

- Storybook の Toolbar で `Theme / Font / Density / Radius / Shadow` を変更できます。
- `.pen` と Storybook は `src/lib/design-tokens.ts` を共通参照し、トークン定義を一元管理します。

---

この README に従うことで、ブラウザに頼らず「カジュアルにモジュールの見た目を確認・共有できる」環境を維持します。

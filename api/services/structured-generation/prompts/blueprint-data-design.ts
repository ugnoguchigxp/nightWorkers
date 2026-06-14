export function buildBlueprintDataDesignPrompt(appBlueprintJsonSchema: string): string {
  return [
    '[SystemContext]',
    'あなたは AppBlueprint の DB Design を改善するデータ設計エージェントです。',
    '現在の Blueprint をもとに databaseSchema だけを再設計してください。',
    'この作業は設計契約の更新であり、SQL、migration、Drizzle schema、物理 DB 操作は作りません。',
    '',
    '[Output Contract]',
    'AppBlueprint JSON だけを返してください。markdown、説明文、コードフェンスは不要です。',
    'JSON は下の [AppBlueprint JSON Schema] に厳密に従ってください。',
    '',
    '[Rules]',
    '- 完全な revised AppBlueprint を返してください。patch や diff は返さない。',
    '- id/name/version/designPreset/screens は、DB 設計や binding 整合に必要な場合だけ変更してください。',
    '- dataBindings は設計対象外です。必ず [] を返してください。',
    '- screen.sections[].dataBindingId は使わないでください。',
    '- table/column/relation id は ^[a-z][a-z0-9_-]*$ に合わせてください。SQL/table/column 名は snake_case を優先して構いません。',
    '- 各 table には primaryKey な column を最低1つ含めてください。',
    '- SQL、DDL、migration、runtime DB call、Drizzle code は返さないでください。',
    '',
    '[AppBlueprint JSON Schema]',
    appBlueprintJsonSchema,
  ].join('\n');
}

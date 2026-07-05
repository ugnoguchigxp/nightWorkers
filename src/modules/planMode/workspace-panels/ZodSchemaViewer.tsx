import { useState } from 'react';
import type { PlanModeWorkspaceArtifact } from '../../nightworkers/types';
import { stringValue, toRecordArray, toStringArray } from './record-utils';

export function ZodSchemaViewer({
  artifact,
  zodSchema,
}: {
  artifact: PlanModeWorkspaceArtifact | null;
  zodSchema: Record<string, unknown>;
}) {
  const title = stringValue(zodSchema.title) || artifact?.title || 'Zod Schema';
  const summary = stringValue(zodSchema.summary);
  const schemaName = stringValue(zodSchema.schemaName) || 'Schema';
  const owner = stringValue(zodSchema.owner);
  const fields = toRecordArray(zodSchema.fields);
  const flatFields = flattenZodFields(fields);
  const source = stringValue(zodSchema.zodSource);
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(flatFields.map((field) => [field.path, zodDefaultValue(field.field)]))
  );
  const validation = validateZodFormFields(flatFields, values);

  function updateValue(name: string, value: unknown) {
    setValues((prev) => ({ ...prev, [name]: value }));
  }

  return (
    <div className="grid gap-3 text-xs">
      <div className="rounded border border-slate-800 bg-slate-950/20 p-3">
        <div className="font-semibold text-slate-100">{title}</div>
        <div className="mt-1 text-slate-500">
          {schemaName}
          {owner ? ` · ${owner}` : ''}{' '}
          {artifact?.sourceMessageId ? ` · message ${artifact.sourceMessageId.slice(0, 8)}` : ''}
        </div>
        {summary ? <p className="mt-2 text-slate-400">{summary}</p> : null}
      </div>

      <div className="grid gap-3">
        <div className="grid gap-3 rounded border border-cyan-500/30 bg-slate-950/30 p-3">
          <div className="text-[11px] font-semibold uppercase text-cyan-100">Validation form</div>
          {fields.length > 0 ? (
            fields.map((field) => {
              const name = stringValue(field.name);
              return (
                <ZodFieldInput
                  key={name}
                  field={field}
                  path={name}
                  values={values}
                  issuesByField={validation.issuesByField}
                  onChange={updateValue}
                />
              );
            })
          ) : (
            <div className="rounded border border-amber-700/70 bg-amber-950/20 p-3 text-amber-100">
              No form-compatible fields were extracted.
            </div>
          )}
          <div
            className={`rounded border p-2 ${
              validation.valid
                ? 'border-emerald-500/40 bg-emerald-950/20 text-emerald-100'
                : 'border-amber-700/70 bg-amber-950/20 text-amber-100'
            }`}
          >
            {validation.valid ? 'Valid sample input' : 'Input has validation issues'}
          </div>
        </div>

        <div className="grid content-start gap-2 rounded border border-slate-800 bg-slate-950/20 p-3">
          <div className="text-[11px] font-semibold uppercase text-slate-400">Field rules</div>
          {flatFields.map(({ field, path }) => (
            <div key={path} className="rounded border border-slate-800 bg-slate-950/40 p-2">
              <div className="font-semibold text-slate-100">{path}</div>
              <div className="mt-1 text-slate-500">
                {[stringValue(field.type), field.required === true ? 'required' : 'optional']
                  .filter(Boolean)
                  .join(' · ')}
              </div>
              {stringValue(field.description) ? (
                <div className="mt-1 text-slate-400">{stringValue(field.description)}</div>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-1">
                {zodFieldRuleLabels(field).map((rule) => (
                  <span
                    key={rule}
                    className="rounded border border-slate-700 bg-slate-900/70 px-1.5 py-0.5 text-[10px] text-slate-200"
                  >
                    {rule}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <details className="rounded border border-slate-800 bg-slate-950/20 p-3" open>
        <summary className="cursor-pointer text-[11px] font-semibold uppercase text-slate-300">
          Zod schema source
        </summary>
        <pre className="nightworkers-code-block mt-2 overflow-x-auto rounded bg-slate-950 p-3 text-[11px] text-slate-200">
          <code>{source}</code>
        </pre>
      </details>
    </div>
  );
}

function ZodFieldInput({
  field,
  path,
  values,
  issuesByField,
  onChange,
}: {
  field: Record<string, unknown>;
  path: string;
  values: Record<string, unknown>;
  issuesByField: Record<string, string[]>;
  onChange: (path: string, value: unknown) => void;
}) {
  const name = stringValue(field.name);
  const type = stringValue(field.type);
  const value = values[path];
  const issues = issuesByField[path] || [];
  const description = stringValue(field.description);
  const referencedSchema = stringValue(field.referencedSchema);
  const children = toRecordArray(field.children);
  const enumOptions = toStringArray(field.enumOptions);
  const describedBy = issues.length > 0 ? `${path}-issues` : undefined;
  const inputId = `zod-field-${path.replace(/[^a-zA-Z0-9_-]/g, '-') || 'field'}`;
  const canInput = isZodFormInputType(type);
  return (
    <div className="grid gap-1 rounded border border-slate-800 bg-slate-950/30 p-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-semibold text-slate-100">{name}</span>
        {description ? <span className="text-[11px] text-slate-400">{description}</span> : null}
        <span className="text-[10px] uppercase text-slate-500">{type || 'unknown'}</span>
        {field.required === true ? (
          <span className="rounded border border-amber-600/50 px-1.5 py-0.5 text-[10px] text-amber-100">
            required
          </span>
        ) : null}
      </div>
      {type === 'object' ? (
        children.length > 0 ? (
          <div className="mt-2 grid gap-2 border-l border-slate-800 pl-3">
            {children.map((child) => {
              const childName = stringValue(child.name);
              const childPath = childName ? `${path}.${childName}` : path;
              return (
                <ZodFieldInput
                  key={childPath}
                  field={child}
                  path={childPath}
                  values={values}
                  issuesByField={issuesByField}
                  onChange={onChange}
                />
              );
            })}
          </div>
        ) : (
          <div className="rounded border border-slate-800 bg-slate-950/50 px-2 py-1 text-[11px] text-slate-400">
            Object schema without extracted child fields.
          </div>
        )
      ) : type === 'reference' ? (
        <div className="rounded border border-slate-800 bg-slate-950/50 px-2 py-1 text-[11px] text-slate-300">
          Referenced schema: {referencedSchema || stringValue(field.zodExpression) || 'unknown'}
        </div>
      ) : type === 'unknown' || !canInput ? (
        <div className="rounded border border-amber-700/60 bg-amber-950/20 px-2 py-1 text-[11px] text-amber-100">
          Unsupported expression: {stringValue(field.zodExpression) || 'unknown'}
        </div>
      ) : type === 'boolean' ? (
        <input
          id={inputId}
          type="checkbox"
          className="h-4 w-4"
          checked={value === true}
          aria-describedby={describedBy}
          onChange={(event) => onChange(path, event.currentTarget.checked)}
        />
      ) : type === 'enum' ? (
        <fieldset id={inputId} className="flex flex-wrap gap-2" aria-describedby={describedBy}>
          {field.required !== true ? (
            <label className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-200">
              <input
                type="radio"
                name={inputId}
                value=""
                checked={value === ''}
                onChange={() => onChange(path, '')}
              />
              <span>unset</span>
            </label>
          ) : null}
          {enumOptions.map((option) => (
            <label
              key={option}
              className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-200"
            >
              <input
                type="radio"
                name={inputId}
                value={option}
                checked={value === option}
                onChange={() => onChange(path, option)}
              />
              <span>{option}</span>
            </label>
          ))}
        </fieldset>
      ) : type === 'array' ? (
        <textarea
          id={inputId}
          className="min-h-20 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] text-slate-100"
          value={typeof value === 'string' ? value : ''}
          placeholder='["value"]'
          aria-describedby={describedBy}
          onChange={(event) => onChange(path, event.currentTarget.value)}
        />
      ) : (
        <input
          id={inputId}
          type={type === 'number' ? 'number' : type === 'string' ? 'text' : 'text'}
          className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100"
          value={typeof value === 'string' || typeof value === 'number' ? value : ''}
          aria-describedby={describedBy}
          onChange={(event) =>
            onChange(
              path,
              type === 'number' ? event.currentTarget.valueAsNumber : event.currentTarget.value
            )
          }
        />
      )}
      {issues.length > 0 ? (
        <span id={describedBy} className="text-[11px] text-amber-200">
          {issues.join(' / ')}
        </span>
      ) : null}
    </div>
  );
}

function zodDefaultValue(field: Record<string, unknown>) {
  if (field.defaultValue !== null && field.defaultValue !== undefined) return field.defaultValue;
  const type = stringValue(field.type);
  if (type === 'string') return zodStringSampleValue(field);
  if (type === 'enum') return toStringArray(field.enumOptions)[0] || '';
  if (type === 'boolean') return false;
  if (type === 'number') return zodNumberSampleValue(field);
  if (type === 'array') return JSON.stringify(zodArraySampleValue(field), null, 2);
  return '';
}

function zodStringSampleValue(field: Record<string, unknown>) {
  const rules = toRecordArray(field.rules);
  if (rules.some((rule) => stringValue(rule.name) === 'email')) return 'sample@example.com';
  if (rules.some((rule) => stringValue(rule.name) === 'url')) return 'https://example.com';
  if (rules.some((rule) => stringValue(rule.name) === 'uuid')) {
    return '123e4567-e89b-42d3-a456-426614174000';
  }
  const exactLength = zodNumericRuleArg(field, 'length');
  if (typeof exactLength === 'number') return 'x'.repeat(Math.max(0, exactLength));
  const minLength = zodNumericRuleArg(field, 'min') ?? 1;
  const maxLength = zodNumericRuleArg(field, 'max');
  const targetLength =
    typeof maxLength === 'number'
      ? Math.min(Math.max(minLength, 1), Math.max(maxLength, 0))
      : Math.max(minLength, 6);
  const sample = 'sample value';
  if (sample.length >= targetLength) return sample.slice(0, targetLength);
  return sample.padEnd(targetLength, 'x');
}

function zodNumberSampleValue(field: Record<string, unknown>) {
  const rules = toRecordArray(field.rules);
  const minValue = zodNumericRuleArg(field, 'min');
  const maxValue = zodNumericRuleArg(field, 'max');
  let value = rules.some((rule) => stringValue(rule.name) === 'positive') ? 1 : 0;
  if (rules.some((rule) => stringValue(rule.name) === 'nonnegative')) value = Math.max(value, 0);
  if (typeof minValue === 'number') value = Math.max(value, minValue);
  if (typeof maxValue === 'number') value = Math.min(value, maxValue);
  if (rules.some((rule) => stringValue(rule.name) === 'int')) value = Math.ceil(value);
  return value;
}

function zodArraySampleValue(field: Record<string, unknown>) {
  const minItems = zodNumericRuleArg(field, 'min') ?? 1;
  const maxItems = zodNumericRuleArg(field, 'max');
  const length =
    typeof maxItems === 'number'
      ? Math.min(Math.max(minItems, 0), Math.max(maxItems, 0))
      : Math.max(minItems, 1);
  return Array.from({ length }, (_, index) => `sample-${index + 1}`);
}

function zodNumericRuleArg(field: Record<string, unknown>, ruleName: string) {
  const rule = toRecordArray(field.rules).find(
    (candidate) => stringValue(candidate.name) === ruleName
  );
  const args = Array.isArray(rule?.args) ? rule.args : [];
  return typeof args[0] === 'number' ? args[0] : null;
}

function zodFieldRuleLabels(field: Record<string, unknown>) {
  const labels = toRecordArray(field.rules).map((rule) => {
    const args = Array.isArray(rule.args) ? rule.args.map(String).join(', ') : '';
    return args ? `${stringValue(rule.name)}(${args})` : stringValue(rule.name);
  });
  if (toStringArray(field.enumOptions).length > 0) {
    labels.unshift(`enum(${toStringArray(field.enumOptions).join(', ')})`);
  }
  const referencedSchema = stringValue(field.referencedSchema);
  if (referencedSchema) labels.unshift(`ref(${referencedSchema})`);
  return labels.filter(Boolean);
}

function flattenZodFields(
  fields: Array<Record<string, unknown>>,
  parentPath = ''
): Array<{ field: Record<string, unknown>; path: string }> {
  return fields.flatMap((field) => {
    const name = stringValue(field.name);
    const path = parentPath && name ? `${parentPath}.${name}` : name || parentPath;
    const children = toRecordArray(field.children);
    if (children.length === 0) return [{ field, path }];
    return [{ field, path }, ...flattenZodFields(children, path)];
  });
}

function isZodFormInputType(type: string) {
  return (
    type === 'string' ||
    type === 'number' ||
    type === 'boolean' ||
    type === 'enum' ||
    type === 'array'
  );
}

function validateZodFormFields(
  fields: Array<{ field: Record<string, unknown>; path: string }>,
  values: Record<string, unknown>
) {
  const issuesByField: Record<string, string[]> = {};
  for (const { field, path } of fields) {
    const type = stringValue(field.type);
    if (!isZodFormInputType(type)) continue;
    const value = values[path];
    const issues: string[] = [];
    const isEmpty =
      value === '' ||
      value === null ||
      value === undefined ||
      (typeof value === 'number' && Number.isNaN(value));
    if (field.required === true && isEmpty) {
      issues.push('required');
    }
    if (!isEmpty) {
      if (type === 'number' && (typeof value !== 'number' || Number.isNaN(value))) {
        issues.push('must be a number');
      }
      if (type === 'enum' && !toStringArray(field.enumOptions).includes(String(value))) {
        issues.push('must match enum option');
      }
      if (type === 'array' && !parseZodArrayInput(value)) {
        issues.push('must be a JSON array');
      }
      for (const rule of toRecordArray(field.rules)) {
        const issue = validateZodRule(type, value, rule);
        if (issue) issues.push(issue);
      }
    }
    if (issues.length > 0) issuesByField[path] = issues;
  }
  return { valid: Object.keys(issuesByField).length === 0, issuesByField };
}

function validateZodRule(type: string, value: unknown, rule: Record<string, unknown>) {
  const name = stringValue(rule.name);
  const args = Array.isArray(rule.args) ? rule.args : [];
  const first = args[0];
  if (name === 'min' && typeof first === 'number') {
    if (type === 'string' && String(value).length < first) return `min length ${first}`;
    if (type === 'number' && Number(value) < first) return `min ${first}`;
    if (type === 'array' && (parseZodArrayInput(value)?.length ?? 0) < first) {
      return `min items ${first}`;
    }
  }
  if (name === 'max' && typeof first === 'number') {
    if (type === 'string' && String(value).length > first) return `max length ${first}`;
    if (type === 'number' && Number(value) > first) return `max ${first}`;
    if (type === 'array' && (parseZodArrayInput(value)?.length ?? 0) > first) {
      return `max items ${first}`;
    }
  }
  if (name === 'length' && typeof first === 'number') {
    if (type === 'array' && (parseZodArrayInput(value)?.length ?? 0) !== first) {
      return `items length ${first}`;
    }
    if (type !== 'array' && String(value).length !== first) return `length ${first}`;
  }
  if (name === 'email' && type === 'string' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) {
    return 'email';
  }
  if (name === 'url' && type === 'string') {
    try {
      new URL(String(value));
    } catch {
      return 'url';
    }
  }
  if (
    name === 'uuid' &&
    type === 'string' &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      String(value)
    )
  ) {
    return 'uuid';
  }
  if (name === 'int' && type === 'number' && !Number.isInteger(Number(value))) return 'integer';
  if (name === 'positive' && type === 'number' && Number(value) <= 0) return 'positive';
  if (name === 'nonnegative' && type === 'number' && Number(value) < 0) return 'nonnegative';
  return null;
}

function parseZodArrayInput(value: unknown) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

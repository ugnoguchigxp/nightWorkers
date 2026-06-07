import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/design-system';
import { useTranslation } from 'react-i18next';

type FieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'password';
};

export function Field({ id, label, value, onChange, type = 'text' }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[11px] font-semibold text-zinc-400">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-100"
      />
    </div>
  );
}

type NumberFieldProps = {
  id: string;
  label: string;
  value: number;
  min?: number;
  onChange: (value: number) => void;
};

export function NumberField({ id, label, value, min = 1, onChange }: NumberFieldProps) {
  return (
    <div className="w-32 space-y-1.5">
      <label htmlFor={id} className="block text-[11px] font-semibold text-zinc-400">
        {label}
      </label>
      <input
        id={id}
        type="number"
        min={min}
        value={value}
        onChange={(e) => onChange(Math.max(min, Number(e.target.value) || min))}
        className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-100"
      />
    </div>
  );
}

type SelectFieldProps = {
  id: string;
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
};

export function SelectField({ id, label, value, options, onChange }: SelectFieldProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[11px] font-semibold text-zinc-400">
        {label}
      </label>
      <Select
        value={value}
        onValueChange={(next) => {
          if (next) onChange(next);
        }}
      >
        <SelectTrigger
          id={id}
          className="w-full rounded-lg border-zinc-800 bg-zinc-900 text-xs text-zinc-100"
        >
          <SelectValue placeholder={t('settings.selectPlaceholder')} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

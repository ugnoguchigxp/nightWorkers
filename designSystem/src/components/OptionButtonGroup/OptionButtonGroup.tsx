import { cn } from '@/utils/cn';
import { Button } from '../Button';

export interface OptionButtonItem<T extends string> {
  value: T;
  label: string;
  description?: string;
}

export interface OptionButtonGroupBaseProps<T extends string> {
  options: OptionButtonItem<T>[];
  columns?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
  alignment?: 'left' | 'center';
  className?: string;
}

export interface SingleOptionButtonGroupProps<T extends string>
  extends OptionButtonGroupBaseProps<T> {
  multiple?: false;
  value: T | null;
  onChange: (value: T | null) => void;
  allowNull?: boolean;
  nullLabel?: string;
}

export interface MultiOptionButtonGroupProps<T extends string>
  extends OptionButtonGroupBaseProps<T> {
  multiple: true;
  value: T[];
  onChange: (value: T[]) => void;
  allowNull?: never;
  nullLabel?: never;
}

export type OptionButtonGroupProps<T extends string> =
  | SingleOptionButtonGroupProps<T>
  | MultiOptionButtonGroupProps<T>;

export function OptionButtonGroup<T extends string>(props: OptionButtonGroupProps<T>) {
  const { options, columns = 2, alignment = 'center', className = '' } = props;

  const gridColsClass = {
    1: 'grid-cols-1',
    2: 'grid-cols-2',
    3: 'grid-cols-3',
    4: 'grid-cols-4',
    5: 'grid-cols-5',
    6: 'grid-cols-6',
    7: 'grid-cols-7',
    8: 'grid-cols-8',
    9: 'grid-cols-9',
    10: 'grid-cols-10',
  }[columns];

  const handleSingleChange = (val: T | null) => {
    if (props.multiple) return;
    props.onChange(val);
  };

  const handleMultiChange = (val: T) => {
    if (!props.multiple) return;
    const currentValues = props.value;
    const newValues = currentValues.includes(val)
      ? currentValues.filter((v) => v !== val)
      : [...currentValues, val];
    props.onChange(newValues);
  };

  const buttonStyles = cn(
    'px-ui py-ui min-h-[44px]',
    alignment === 'center' ? 'justify-center text-center' : 'justify-start text-left',
    columns >= 9 ? 'px-0 text-[10px]' : columns >= 7 ? 'px-0.5 text-xs' : columns >= 5 ? 'px-1' : ''
  );

  const gapClass = columns >= 7 ? 'gap-0.5' : 'gap-2';

  return (
    <div className={`grid ${gridColsClass} ${gapClass} ${className}`}>
      {!props.multiple && props.allowNull && (
        <Button
          type="button"
          variant={props.value === null ? 'option-active' : 'option'}
          size={undefined}
          onClick={() => handleSingleChange(null)}
          className={buttonStyles}
          maxLabelLength={100}
        >
          <div className="font-medium text-foreground">{props.nullLabel || '自動'}</div>
        </Button>
      )}
      {options.map((option) => {
        const isSelected = props.multiple
          ? props.value.includes(option.value)
          : props.value === option.value;

        return (
          <Button
            key={option.value}
            type="button"
            variant={isSelected ? 'option-active' : 'option'}
            size={undefined}
            onClick={() =>
              props.multiple ? handleMultiChange(option.value) : handleSingleChange(option.value)
            }
            className={buttonStyles}
            maxLabelLength={100}
          >
            {option.description ? (
              <div>
                <div className="font-medium text-foreground">{option.label}</div>
                <div className="text-xs text-muted-foreground mt-1">{option.description}</div>
              </div>
            ) : (
              <div className="font-medium text-foreground">{option.label}</div>
            )}
          </Button>
        );
      })}
    </div>
  );
}

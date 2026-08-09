type FieldProps = {
	id: string;
	label: string;
	value: string;
	onChange: (value: string) => void;
	type?: "text" | "password";
};

export function Field({
	id,
	label,
	value,
	onChange,
	type = "text",
}: FieldProps) {
	return (
		<div className="space-y-1.5">
			<label
				htmlFor={id}
				className="block text-[11px] font-semibold text-zinc-400"
			>
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
	max?: number;
	clampOnBlur?: boolean;
	onChange: (value: number) => void;
};

function clampNumber(value: number, min: number, max?: number) {
	const minimumClamped = Math.max(min, value);
	return max === undefined ? minimumClamped : Math.min(max, minimumClamped);
}

export function NumberField({
	id,
	label,
	value,
	min = 1,
	max,
	clampOnBlur = false,
	onChange,
}: NumberFieldProps) {
	return (
		<div className="w-32 space-y-1.5">
			<label
				htmlFor={id}
				className="block text-[11px] font-semibold text-zinc-400"
			>
				{label}
			</label>
			<input
				id={id}
				type="number"
				min={min}
				max={max}
				value={value}
				onChange={(e) => {
					const parsed = Number(e.target.value);
					onChange(clampOnBlur ? parsed : clampNumber(parsed || min, min, max));
				}}
				onBlur={(e) => {
					if (!clampOnBlur) return;
					const parsed = Number(e.currentTarget.value);
					const clamped = clampNumber(parsed || min, min, max);
					if (clamped !== value) onChange(clamped);
				}}
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

export function SelectField({
	id,
	label,
	value,
	options,
	onChange,
}: SelectFieldProps) {
	return (
		<div className="space-y-1.5">
			<label
				htmlFor={id}
				className="block text-[11px] font-semibold text-zinc-400"
			>
				{label}
			</label>
			<select
				id={id}
				value={value}
				onChange={(event) => onChange(event.target.value)}
				className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-100"
			>
				{options.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</select>
		</div>
	);
}

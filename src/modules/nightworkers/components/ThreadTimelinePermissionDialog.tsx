import { Button } from "@/components/ui/Button";
import { ThreadMessage } from "./ThreadMessage";

export function ThreadTimelinePermissionDialog(props: {
	path: string;
	isGranting: boolean;
	error: string | null;
	onDismiss: () => void;
	onGrant: () => Promise<void>;
}) {
	return (
		<ThreadMessage messageRole="assistant">
			<div
				className="max-w-2xl rounded-lg border border-slate-700 bg-slate-950/80 p-4"
				role="dialog"
				aria-labelledby="external-path-permission-title"
				aria-describedby="external-path-permission-description"
			>
				<div
					id="external-path-permission-title"
					className="text-sm font-semibold text-slate-100"
				>
					外部フォルダへのアクセス許可
				</div>
				<div
					id="external-path-permission-description"
					className="mt-2 text-xs leading-5 text-slate-300"
				>
					続行するには、このフォルダの読み取り許可が必要です。
				</div>
				<div className="mt-3 break-all rounded-md border border-slate-800 bg-slate-900 px-3 py-2 font-mono text-[11px] text-slate-200">
					{props.path}
				</div>
				<div className="mt-4 flex justify-end gap-2">
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={props.onDismiss}
					>
						閉じる
					</Button>
					<Button
						type="button"
						size="sm"
						disabled={props.isGranting}
						onClick={() => void props.onGrant()}
					>
						フォルダを許可
					</Button>
				</div>
				{props.error ? (
					<div
						className="mt-3 rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-200"
						role="alert"
					>
						{props.error}
					</div>
				) : null}
			</div>
		</ThreadMessage>
	);
}

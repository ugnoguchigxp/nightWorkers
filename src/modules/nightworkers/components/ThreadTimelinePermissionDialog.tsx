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
				className="nightworkers-chat-card max-w-2xl rounded-lg border p-4"
				role="dialog"
				aria-labelledby="external-path-permission-title"
				aria-describedby="external-path-permission-description"
			>
				<div
					id="external-path-permission-title"
					className="nightworkers-chat-card-title text-sm font-semibold"
				>
					外部フォルダへのアクセス許可
				</div>
				<div
					id="external-path-permission-description"
					className="nightworkers-chat-card-meta mt-2 text-xs leading-5"
				>
					続行するには、このフォルダの読み取り許可が必要です。
				</div>
				<div className="nightworkers-chat-card-code mt-3 break-all rounded-md border border-[color:var(--nw-code-border)] px-3 py-2 font-mono text-[11px]">
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
						className="nightworkers-chat-card-danger mt-3 rounded-md border px-3 py-2 text-xs"
						role="alert"
					>
						{props.error}
					</div>
				) : null}
			</div>
		</ThreadMessage>
	);
}

import {
	type CodingAgentCommandRequestV1,
	type CodingAgentCommandResponseV1,
	codingAgentCommandResponseV1Schema,
} from "../../../../shared/modules/codingAgent";

export type NightWorkersRealtimeMessage = {
	type?: string;
	[key: string]: unknown;
};

export type NightWorkersRealtimeConnectionOptions = {
	primaryUrl: string;
	fallbackUrl?: string | null;
	onOpen?: () => void;
	onMessage: (message: NightWorkersRealtimeMessage, byteSize: number) => void;
	onConnectionStateChange?: (connected: boolean) => void;
	onReconnectExhausted?: () => void;
};

type PendingCommand = {
	resolve: (response: CodingAgentCommandResponseV1) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
};

export class NightWorkersRealtimeUnavailableError extends Error {
	constructor(message = "Coding Agent WebSocket is unavailable.") {
		super(message);
		this.name = "NightWorkersRealtimeUnavailableError";
	}
}

export class NightWorkersRealtimeConnection {
	private socket: WebSocket | null = null;
	private started = false;
	private disposed = false;
	private reconnectAttempts = 0;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private initialConnectTimer: ReturnType<typeof setTimeout> | null = null;
	private fallbackTimer: ReturnType<typeof setTimeout> | null = null;
	private usingFallback = false;
	private readonly capabilities = new Set<string>();
	private readonly pendingCommands = new Map<string, PendingCommand>();

	constructor(
		private readonly options: NightWorkersRealtimeConnectionOptions,
	) {}

	start() {
		if (this.disposed || this.started) return;
		this.started = true;
		setActiveNightWorkersRealtimeConnection(this);
		this.initialConnectTimer = setTimeout(
			() => this.connect(this.options.primaryUrl),
			0,
		);
		this.fallbackTimer = setTimeout(() => {
			const fallbackUrl = this.options.fallbackUrl;
			if (
				this.disposed ||
				this.isOpen() ||
				!fallbackUrl ||
				fallbackUrl === this.options.primaryUrl
			)
				return;
			const previousSocket = this.socket;
			this.socket = null;
			try {
				previousSocket?.close();
			} catch {
				// Continue with the fallback even if a connecting socket cannot close.
			}
			this.usingFallback = true;
			this.connect(fallbackUrl);
		}, 1500);
	}

	isOpen() {
		return this.socket?.readyState === WebSocket.OPEN;
	}

	hasCapability(capability: string) {
		return this.isOpen() && this.capabilities.has(capability);
	}

	send(message: unknown) {
		if (!this.isOpen()) return false;
		try {
			this.socket?.send(JSON.stringify(message));
			return true;
		} catch {
			return false;
		}
	}

	requestCodingAgentCommand(
		request: CodingAgentCommandRequestV1,
		timeoutMs: number,
	): Promise<CodingAgentCommandResponseV1> {
		if (!this.isOpen())
			return Promise.reject(new NightWorkersRealtimeUnavailableError());
		if (this.pendingCommands.has(request.requestId))
			return Promise.reject(
				new Error("Coding Agent command request is already pending."),
			);
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pendingCommands.delete(request.requestId);
				reject(
					new NightWorkersRealtimeUnavailableError(
						"Coding Agent WebSocket response timed out.",
					),
				);
			}, timeoutMs);
			this.pendingCommands.set(request.requestId, { resolve, reject, timer });
			try {
				this.socket?.send(JSON.stringify(request));
			} catch (error) {
				clearTimeout(timer);
				this.pendingCommands.delete(request.requestId);
				reject(
					error instanceof Error
						? error
						: new NightWorkersRealtimeUnavailableError(),
				);
			}
		});
	}

	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		if (this.initialConnectTimer) clearTimeout(this.initialConnectTimer);
		if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
		this.rejectPendingCommands(
			new NightWorkersRealtimeUnavailableError(
				"Coding Agent WebSocket connection was disposed.",
			),
		);
		const socket = this.socket;
		this.socket = null;
		try {
			socket?.close();
		} catch {
			// Disposal must still release local state when the socket cannot close.
		}
		this.capabilities.clear();
		this.options.onConnectionStateChange?.(false);
		if (getActiveNightWorkersRealtimeConnection() === this)
			setActiveNightWorkersRealtimeConnection(null);
	}

	private connect(url: string) {
		if (this.disposed) return;
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		const socket = new WebSocket(url);
		this.socket = socket;
		socket.addEventListener("open", () => {
			if (this.disposed || this.socket !== socket) return;
			this.reconnectAttempts = 0;
			this.options.onConnectionStateChange?.(true);
			this.options.onOpen?.();
		});
		socket.addEventListener("message", (event) => {
			if (this.disposed || this.socket !== socket) return;
			this.handleMessage(event.data);
		});
		socket.addEventListener("close", () => {
			if (this.socket !== socket) return;
			this.capabilities.clear();
			this.options.onConnectionStateChange?.(false);
			this.rejectPendingCommands(new NightWorkersRealtimeUnavailableError());
			if (this.disposed) return;
			if (this.reconnectAttempts >= 8) {
				this.options.onReconnectExhausted?.();
				return;
			}
			const backoffMs = Math.min(2000 * 2 ** this.reconnectAttempts, 30000);
			this.reconnectAttempts += 1;
			this.reconnectTimer = setTimeout(() => {
				const nextUrl =
					this.usingFallback && this.options.fallbackUrl
						? this.options.fallbackUrl
						: url;
				this.connect(nextUrl);
			}, backoffMs);
		});
		socket.addEventListener("error", () => {
			if (this.socket !== socket) return;
			this.options.onConnectionStateChange?.(false);
		});
	}

	private handleMessage(raw: unknown) {
		const wire = String(raw);
		const byteSize = new TextEncoder().encode(wire).byteLength;
		let message: NightWorkersRealtimeMessage;
		try {
			message = JSON.parse(wire) as NightWorkersRealtimeMessage;
		} catch {
			this.options.onMessage({}, byteSize);
			return;
		}
		if (message.type === "connected") {
			this.capabilities.clear();
			if (Array.isArray(message.capabilities)) {
				for (const capability of message.capabilities) {
					if (typeof capability === "string") this.capabilities.add(capability);
				}
			}
		}
		const commandResponse =
			codingAgentCommandResponseV1Schema.safeParse(message);
		if (commandResponse.success) {
			const pending = this.pendingCommands.get(commandResponse.data.requestId);
			if (!pending) return;
			clearTimeout(pending.timer);
			this.pendingCommands.delete(commandResponse.data.requestId);
			pending.resolve(commandResponse.data);
			return;
		}
		this.options.onMessage(message, byteSize);
	}

	private rejectPendingCommands(error: Error) {
		for (const pending of this.pendingCommands.values()) {
			clearTimeout(pending.timer);
			pending.reject(error);
		}
		this.pendingCommands.clear();
	}
}

let activeConnection: NightWorkersRealtimeConnection | null = null;

export function getActiveNightWorkersRealtimeConnection() {
	return activeConnection;
}

function setActiveNightWorkersRealtimeConnection(
	connection: NightWorkersRealtimeConnection | null,
) {
	activeConnection = connection;
}

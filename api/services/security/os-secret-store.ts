import { execFileSync } from "node:child_process";

const SERVICE_NAME = "com.nightworkers.application-settings";
const sessionSecrets = new Map<string, string>();

export type SecretStoreProvider =
	| "keychain"
	| "libsecret"
	| "credential_manager"
	| "session";

export function readSecretStoreValue(account: string): string | null {
	if (process.env.NIGHTWORKERS_EXECUTION_ROLE === "worker") return null;
	const provider = resolveSecretStoreProvider();
	if (provider === "session") return sessionSecrets.get(account) ?? null;
	try {
		if (provider === "keychain") {
			return execFileSync(
				"security",
				["find-generic-password", "-s", SERVICE_NAME, "-a", account, "-w"],
				{ encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] },
			).trim();
		}
		if (provider === "libsecret") {
			return execFileSync(
				"secret-tool",
				["lookup", "service", SERVICE_NAME, "account", account],
				{ encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] },
			).trim();
		}
		if (provider === "credential_manager") {
			return runWindowsCredentialScript(
				account,
				[
					"$c=$v.Retrieve($r,$a)",
					"$c.RetrievePassword()",
					"[Console]::Out.Write($c.Password)",
				].join(";"),
			).trim();
		}
		return null;
	} catch {
		return null;
	}
}

export function writeSecretStoreValue(account: string, value: string) {
	if (process.env.NIGHTWORKERS_EXECUTION_ROLE === "worker") {
		throw new Error("WORKER_SECRET_STORE_ACCESS_DENIED");
	}
	const provider = resolveSecretStoreProvider();
	if (provider === "session") {
		sessionSecrets.set(account, value);
		return;
	}
	if (provider === "keychain") {
		const invocation = buildMacOsKeychainWriteInvocation(account, value);
		execFileSync(invocation.command, invocation.args, {
			input: invocation.input,
			stdio: ["pipe", "ignore", "ignore"],
		});
		return;
	}
	if (provider === "libsecret") {
		execFileSync(
			"secret-tool",
			[
				"store",
				"--label",
				"NightWorkers application setting",
				"service",
				SERVICE_NAME,
				"account",
				account,
			],
			{ input: value, stdio: ["pipe", "ignore", "ignore"] },
		);
		return;
	}
	if (provider === "credential_manager") {
		runWindowsCredentialScript(
			account,
			[
				"$p=[Console]::In.ReadToEnd()",
				"$c=New-Object Windows.Security.Credentials.PasswordCredential($r,$a,$p)",
				"$v.Add($c)",
			].join(";"),
			value,
		);
		return;
	}
	throw new Error("OS secret store is unavailable");
}

export function deleteSecretStoreValue(account: string) {
	if (process.env.NIGHTWORKERS_EXECUTION_ROLE === "worker") {
		throw new Error("WORKER_SECRET_STORE_ACCESS_DENIED");
	}
	const provider = resolveSecretStoreProvider();
	if (provider === "session") {
		sessionSecrets.delete(account);
		return;
	}
	try {
		if (provider === "keychain") {
			execFileSync(
				"security",
				["delete-generic-password", "-s", SERVICE_NAME, "-a", account],
				{ stdio: "ignore" },
			);
		} else if (provider === "libsecret") {
			execFileSync(
				"secret-tool",
				["clear", "service", SERVICE_NAME, "account", account],
				{ stdio: "ignore" },
			);
		} else if (provider === "credential_manager") {
			runWindowsCredentialScript(
				account,
				"$c=$v.Retrieve($r,$a);$v.Remove($c)",
			);
		}
	} catch {
		// Deleting an absent value is idempotent.
	}
}

export function resolveSecretStoreProvider(): SecretStoreProvider {
	if (
		process.env.NODE_ENV === "test" ||
		process.env.NIGHTWORKERS_SECRET_STORE === "session"
	) {
		return "session";
	}
	if (process.platform === "darwin" && commandAvailable("security")) {
		return "keychain";
	}
	if (process.platform === "linux" && commandAvailable("secret-tool")) {
		return "libsecret";
	}
	if (
		process.platform === "win32" &&
		commandAvailable("powershell.exe", ["-NoProfile", "-Command", "exit 0"])
	) {
		return "credential_manager";
	}
	return "session";
}

function commandAvailable(command: string, args = ["--help"]) {
	try {
		execFileSync(command, args, {
			stdio: "ignore",
			timeout: 2_000,
		});
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code !== "ENOENT";
	}
}

function quoteSecurityInteractiveArgument(value: string) {
	return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function buildMacOsKeychainWriteInvocation(
	account: string,
	value: string,
) {
	return {
		command: "security",
		args: ["-i"],
		input: [
			"add-generic-password",
			"-U",
			"-s",
			quoteSecurityInteractiveArgument(SERVICE_NAME),
			"-a",
			quoteSecurityInteractiveArgument(account),
			"-X",
			Buffer.from(value, "utf-8").toString("hex"),
		].join(" "),
	};
}

function runWindowsCredentialScript(
	account: string,
	operation: string,
	input?: string,
) {
	const accountBase64 = Buffer.from(account, "utf-8").toString("base64");
	const resourceBase64 = Buffer.from(SERVICE_NAME, "utf-8").toString("base64");
	const bootstrap = [
		"Add-Type -AssemblyName System.Runtime.WindowsRuntime",
		"$null=[Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]",
		`$r=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${resourceBase64}'))`,
		`$a=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${accountBase64}'))`,
		"$v=New-Object Windows.Security.Credentials.PasswordVault",
		operation,
	].join(";");
	return execFileSync(
		"powershell.exe",
		["-NoProfile", "-NonInteractive", "-Command", bootstrap],
		{
			encoding: "utf-8",
			input,
			stdio: ["pipe", "pipe", "ignore"],
		},
	);
}

export function clearSessionSecretStoreForTests() {
	if (process.env.NODE_ENV === "test") sessionSecrets.clear();
}

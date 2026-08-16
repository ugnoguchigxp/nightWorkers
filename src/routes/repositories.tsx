import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	FolderGit2,
	GitBranch,
	Plus,
	Shield,
	Terminal,
	Trash2,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { client } from "../lib/api";
import { readJsonResponse } from "../lib/api-error";
import {
	repositoriesQueryOptions,
	repositoryQueryKeys,
} from "../modules/nightworkers/queries/repository-queries";
import type { CreateProjectInput } from "../modules/nightworkers/types";

export const Route = createFileRoute("/repositories")({
	component: RepositoriesPage,
});

export function RepositoriesPage() {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const [name, setName] = useState("");
	const [localPath, setLocalPath] = useState("");
	const [branch, setBranch] = useState("main");
	const [allowedPaths, setAllowedPaths] = useState("");
	const [deniedPaths, setDeniedPaths] = useState("");
	const [blockedCommands, setBlockedCommands] = useState(
		"rm -rf,npm publish,git push",
	);
	const [maxCommandSeconds, setMaxCommandSeconds] = useState(60);
	const [requireReadBeforeEdit, setRequireReadBeforeEdit] = useState(true);
	const [trackedSecretFilesAcknowledged, setTrackedSecretFilesAcknowledged] =
		useState(false);

	// Fetch Repositories
	const { data: repos = [], isLoading } = useQuery(repositoriesQueryOptions());

	// Create Repository Mutation
	const createRepoMutation = useMutation({
		mutationFn: async (data: CreateProjectInput) => {
			const res = await client.repositories.$post({ json: data });
			return readJsonResponse(res);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: repositoryQueryKeys.all });
			setName("");
			setLocalPath("");
			setBranch("main");
			setAllowedPaths("");
			setDeniedPaths("");
			setBlockedCommands("rm -rf,npm publish,git push");
			setMaxCommandSeconds(60);
			setRequireReadBeforeEdit(true);
			setTrackedSecretFilesAcknowledged(false);
		},
	});

	// Delete Repository Mutation
	const deleteRepoMutation = useMutation({
		mutationFn: async (id: string) => {
			const res = await client.repositories[":id"].$delete({ param: { id } });
			return readJsonResponse(res);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: repositoryQueryKeys.all });
		},
	});
	const repositoryMutationError =
		createRepoMutation.error ?? deleteRepoMutation.error;

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (!name || !localPath) return;

		const safetyPolicy = {
			allowedPaths: allowedPaths
				? allowedPaths.split(",").map((s) => s.trim())
				: undefined,
			deniedPaths: deniedPaths
				? deniedPaths.split(",").map((s) => s.trim())
				: undefined,
			blockedCommands: blockedCommands
				? blockedCommands.split(",").map((s) => s.trim())
				: [],
			maxCommandSeconds: Number(maxCommandSeconds),
			requireReadBeforeEdit,
			trackedSecretFilesAcknowledged,
		};

		createRepoMutation.mutate({ name, localPath, branch, safetyPolicy });
	};

	return (
		<div className="max-w-7xl mx-auto px-6 py-10">
			<div className="mb-8">
				<h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-primary to-cyan-400 bg-clip-text text-transparent">
					{t("repositories.title")}
				</h1>
				<p className="text-muted-foreground">{t("repositories.description")}</p>
				{repositoryMutationError ? (
					<p className="mt-2 text-sm text-rose-400" role="alert">
						{repositoryMutationError instanceof Error
							? repositoryMutationError.message
							: String(repositoryMutationError)}
					</p>
				) : null}
			</div>

			<div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
				{/* Registration Panel */}
				<div className="lg:col-span-1 bg-card border border-border rounded-xl p-6 shadow-lg shadow-black/20">
					<h2 className="text-xl font-bold mb-4 flex items-center gap-2 text-foreground">
						<Plus className="h-5 w-5 text-primary" />
						{t("repositories.register")}
					</h2>
					<form onSubmit={handleSubmit} className="space-y-4">
						<div>
							<span className="block text-sm font-medium text-muted-foreground mb-1">
								{t("repositories.friendlyName")}
							</span>
							<input
								type="text"
								placeholder={t("repositories.friendlyNamePlaceholder")}
								value={name}
								onChange={(e) => setName(e.target.value)}
								className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
								required
							/>
						</div>

						<div>
							<span className="block text-sm font-medium text-muted-foreground mb-1">
								{t("repositories.localPath")}
							</span>
							<input
								type="text"
								placeholder={t("repositories.localPathPlaceholder")}
								value={localPath}
								onChange={(e) => setLocalPath(e.target.value)}
								className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
								required
							/>
						</div>

						<div>
							<span className="block text-sm font-medium text-muted-foreground mb-1">
								{t("repositories.targetBranch")}
							</span>
							<input
								type="text"
								placeholder={t("repositories.targetBranchPlaceholder")}
								value={branch}
								onChange={(e) => setBranch(e.target.value)}
								className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
								required
							/>
						</div>

						<div className="border-t border-border/60 pt-4 mt-4 space-y-4">
							<h3 className="text-sm font-bold text-foreground flex items-center gap-1.5">
								<Shield className="h-4 w-4 text-emerald-400" />
								{t("repositories.safetyPolicies")}
							</h3>

							<div>
								<span className="block text-xs font-medium text-muted-foreground mb-1">
									{t("repositories.allowedSubdirs")}
								</span>
								<input
									type="text"
									placeholder={t("repositories.allowedSubdirsPlaceholder")}
									value={allowedPaths}
									onChange={(e) => setAllowedPaths(e.target.value)}
									className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
								/>
							</div>

							<div>
								<span className="block text-xs font-medium text-muted-foreground mb-1">
									{t("repositories.deniedSubdirs")}
								</span>
								<input
									type="text"
									placeholder={t("repositories.deniedSubdirsPlaceholder")}
									value={deniedPaths}
									onChange={(e) => setDeniedPaths(e.target.value)}
									className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
								/>
							</div>

							<div>
								<span className="block text-xs font-medium text-muted-foreground mb-1">
									{t("repositories.blockedCommands")}
								</span>
								<input
									type="text"
									placeholder={t("repositories.blockedCommandsPlaceholder")}
									value={blockedCommands}
									onChange={(e) => setBlockedCommands(e.target.value)}
									className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
								/>
							</div>

							<div className="flex gap-4">
								<div className="flex-1">
									<span className="block text-xs font-medium text-muted-foreground mb-1">
										{t("repositories.commandTimeout")}
									</span>
									<input
										type="number"
										value={maxCommandSeconds}
										onChange={(e) =>
											setMaxCommandSeconds(Number(e.target.value))
										}
										className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
										required
									/>
								</div>

								<div className="flex-1 flex items-center gap-2 pt-5">
									<input
										type="checkbox"
										id="requireRead"
										checked={requireReadBeforeEdit}
										onChange={(e) => setRequireReadBeforeEdit(e.target.checked)}
										className="rounded bg-background border-border text-primary focus:ring-primary h-4 w-4"
									/>
									<label
										htmlFor="requireRead"
										className="text-xs font-medium text-muted-foreground cursor-pointer select-none"
									>
										{t("repositories.readBeforeEdit")}
									</label>
								</div>
							</div>
							<label className="flex items-start gap-2 text-xs text-muted-foreground">
								<input
									type="checkbox"
									checked={trackedSecretFilesAcknowledged}
									onChange={(event) =>
										setTrackedSecretFilesAcknowledged(event.target.checked)
									}
									className="mt-0.5 rounded bg-background border-border text-primary focus:ring-primary h-4 w-4"
								/>
								<span>{t("repositories.secretAcknowledgement")}</span>
							</label>
						</div>

						<Button
							type="submit"
							disabled={createRepoMutation.isPending}
							className="w-full"
						>
							{createRepoMutation.isPending
								? t("repositories.registering")
								: t("repositories.registerWorkspace")}
						</Button>
					</form>
				</div>

				{/* Repositories List Panel */}
				<div className="lg:col-span-2 space-y-4">
					<h2 className="text-xl font-bold flex items-center gap-2 text-foreground">
						<FolderGit2 className="h-5 w-5 text-cyan-400" />
						{t("repositories.registeredWorkspaces")}
					</h2>

					{isLoading ? (
						<div
							className="text-center py-12 border border-border border-dashed rounded-xl bg-card/25"
							aria-busy="true"
						>
							<p className="text-muted-foreground">
								{t("repositories.loading")}
							</p>
						</div>
					) : repos.length === 0 ? (
						<div className="text-center py-12 border border-border border-dashed rounded-xl bg-card/25">
							<FolderGit2 className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
							<p className="text-muted-foreground">{t("repositories.empty")}</p>
						</div>
					) : (
						<div className="grid gap-4">
							{repos.map((repo) => (
								<div
									key={repo.id}
									className="bg-card border border-border rounded-xl p-5 shadow-sm transition-all flex items-center justify-between gap-4"
								>
									<div className="space-y-1">
										<h3 className="font-bold text-lg text-foreground">
											{repo.name}
										</h3>
										<div className="flex flex-col gap-1 text-sm text-muted-foreground">
											<div className="flex items-center gap-1.5">
												<Terminal className="h-3.5 w-3.5 text-muted-foreground/60" />
												<span className="font-mono">{repo.localPath}</span>
											</div>
											<div className="flex items-center gap-1.5">
												<GitBranch className="h-3.5 w-3.5 text-muted-foreground/60" />
												<span>{repo.branch}</span>
												<span className="text-border">|</span>
												<Shield className="h-3.5 w-3.5 text-muted-foreground/60" />
												<span>{t("repositories.sandboxActive")}</span>
											</div>
											<div className="font-mono text-xs">
												identity {repo.repositoryIdentityStatus ?? "unknown"} v
												{repo.repositoryIdentityRevision ?? 0} / base{" "}
												{repo.baseWorktreeBranch || "—"} @{" "}
												{repo.baseWorktreeHeadSha || "—"} /{" "}
												{repo.baseWorktreeDirty ? "dirty" : "clean"}
											</div>
										</div>
									</div>

									<Button
										onClick={() => {
											if (confirm(t("repositories.deleteConfirm"))) {
												deleteRepoMutation.mutate(repo.id);
											}
										}}
										disabled={deleteRepoMutation.isPending}
										variant="ghost"
										size="sm"
										className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 gap-1.5"
									>
										<Trash2 className="h-4 w-4" />
										{t("repositories.delete")}
									</Button>
								</div>
							))}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

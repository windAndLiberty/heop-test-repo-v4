"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.GitAutomation = void 0;
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class GitAutomation {
    store;
    config;
    constructor(storeOrConfig, config) {
        if (config) {
            this.store = storeOrConfig;
            this.config = config;
        }
        else {
            this.config = storeOrConfig;
        }
    }
    async milestoneCommit(args) {
        const { project_id, message_prefix, milestone_name, working_dir, push_remote, create_remote, remote_name, repo_visibility } = args;
        if (!this.config.gitAutoCommit) {
            return {
                content: [
                    {
                        type: 'text',
                        text: 'Git auto-commit is disabled in config',
                    },
                ],
            };
        }
        const cwd = working_dir || process.cwd();
        try {
            // Ensure git repo exists
            const gitDir = path.join(cwd, '.git');
            if (!fs.existsSync(gitDir)) {
                await this.gitInit(cwd);
            }
            // Get recent changes from SSOT
            const recentFacts = this.store?.getCurrentFacts ? this.store.getCurrentFacts(project_id) : [];
            const recentDecisions = this.store?.getDecisions ? this.store.getDecisions(project_id) : [];
            const recentTasks = this.store?.getRecentTasks ? this.store.getRecentTasks(project_id, 5) : [];
            // Build Conventional Commit message
            const commitMessage = this.buildCommitMessage(message_prefix, recentDecisions, recentTasks, recentFacts);
            // Record commit intent in SSOT
            if (this.store) {
                this.store.insertFact(project_id, {
                    entity: 'git',
                    attribute: 'commit_pending',
                    value: commitMessage,
                    source: 'hermes-git-auto',
                    value_type: 'string',
                });
            }
            // Stage all changes and commit
            const gitResult = await this.executeGitCommit(cwd, commitMessage);
            // Record the commit in SSOT
            if (this.store) {
                this.store.insertFact(project_id, {
                    entity: 'git',
                    attribute: 'commit',
                    value: gitResult.hash || 'unknown',
                    source: 'hermes-git',
                    value_type: 'string',
                });
            }
            // Tag if milestone
            let tagName;
            if (milestone_name) {
                tagName = this.generateTagName(milestone_name);
                await this.executeGitTag(cwd, tagName, milestone_name);
                if (this.store) {
                    this.store.insertFact(project_id, {
                        entity: 'git',
                        attribute: 'tag',
                        value: tagName,
                        source: 'hermes-git',
                        value_type: 'string',
                    });
                }
            }
            // Create remote repo if requested
            let remoteUrl;
            if (create_remote) {
                const repoName = remote_name || path.basename(cwd);
                const visibility = repo_visibility || 'public';
                const createResult = await this.createRemoteRepo({
                    project_id,
                    repo_name: repoName,
                    working_dir: cwd,
                    visibility: visibility,
                    push_after_create: false, // We'll push separately
                });
                // Handle both JSON string and already-parsed content
                let createData;
                const createText = createResult.content?.[0]?.text || createResult;
                try {
                    createData = JSON.parse(createText);
                }
                catch {
                    createData = { success: false, raw: createText };
                }
                remoteUrl = createData.remote_url;
                // Re-check if remote was added by createRemoteRepo
                if (!remoteUrl) {
                    try {
                        const remotes = await this.gitSpawnWithOutput(cwd, ['remote', '-v']);
                        const match = remotes.match(/origin\s+(\S+)/);
                        remoteUrl = match ? match[1] : undefined;
                    }
                    catch {
                        // ignore
                    }
                }
            }
            // Push to remote if requested
            let pushResult;
            if (push_remote) {
                pushResult = await this.pushToRemote(cwd, 'master');
            }
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            success: true,
                            commit_hash: gitResult.hash,
                            commit_message: commitMessage,
                            tag: tagName,
                            working_dir: cwd,
                            remote_url: remoteUrl,
                            push_result: pushResult,
                            referenced_decisions: recentDecisions.map((d) => d.id),
                            referenced_tasks: recentTasks.map((t) => t.id),
                        }, null, 2),
                    },
                ],
            };
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            return {
                content: [
                    {
                        type: 'text',
                        text: `Git milestone commit failed: ${errorMsg}`,
                    },
                ],
                isError: true,
            };
        }
    }
    /**
     * Create a remote GitHub repository using gh CLI
     */
    async createRemoteRepo(args) {
        const { project_id, repo_name, working_dir, visibility, description, push_after_create } = args;
        const cwd = working_dir || process.cwd();
        try {
            // Ensure git repo exists first
            const gitDir = path.join(cwd, '.git');
            if (!fs.existsSync(gitDir)) {
                await this.gitInit(cwd);
            }
            // Check if gh CLI is available and authenticated
            await this.ghSpawn(['auth', 'status']);
            // Check if remote already exists
            const remotes = await this.gitSpawnWithOutput(cwd, ['remote', '-v']);
            if (remotes.includes('origin')) {
                // Extract existing remote URL
                const match = remotes.match(/origin\s+(\S+)/);
                const existingUrl = match ? match[1] : undefined;
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                success: true,
                                repo_name,
                                remote_url: existingUrl,
                                note: 'Remote origin already exists',
                            }, null, 2),
                        },
                    ],
                };
            }
            // Create remote repo via gh CLI
            const visFlag = visibility === 'private' ? '--private' : '--public';
            const args2 = ['repo', 'create', repo_name, visFlag];
            if (description)
                args2.push(`--description=${description}`);
            await this.ghSpawn(args2);
            // Get the remote URL
            const remoteUrl = `https://github.com/windAndLiberty/${repo_name}.git`;
            // Add remote to local repo
            await this.gitSpawn(cwd, ['remote', 'add', 'origin', remoteUrl]);
            // Record in SSOT
            if (this.store) {
                this.store.insertFact(project_id, {
                    entity: 'git',
                    attribute: 'remote_origin',
                    value: remoteUrl,
                    source: 'hermes-git-auto',
                    value_type: 'string',
                });
            }
            // Push if requested
            let pushResult;
            if (push_after_create) {
                pushResult = await this.pushToRemote(cwd, 'master');
            }
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            success: true,
                            repo_name,
                            remote_url: remoteUrl,
                            visibility: visibility || 'public',
                            pushed: push_after_create,
                            push_result: pushResult,
                        }, null, 2),
                    },
                ],
            };
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            success: false,
                            error: errorMsg,
                        }, null, 2),
                    },
                ],
                isError: true,
            };
        }
    }
    /**
     * Push local commits and tags to remote
     */
    async pushToRemote(cwd, branch = 'master') {
        try {
            // Check if remote exists
            const remotes = await this.gitSpawnWithOutput(cwd, ['remote']);
            if (!remotes.trim()) {
                throw new Error('No remote configured. Run createRemoteRepo first.');
            }
            // Push commits
            await this.gitSpawn(cwd, ['push', 'origin', branch]);
            // Push tags
            await this.gitSpawn(cwd, ['push', 'origin', '--tags']);
            // Get latest remote log
            const remoteLog = await this.gitSpawnWithOutput(cwd, ['log', '--oneline', '-3']);
            return {
                success: true,
                branch,
                remote_log: remoteLog.trim().split('\n'),
            };
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            return {
                success: false,
                error: errorMsg,
            };
        }
    }
    buildCommitMessage(prefix, decisions, tasks, facts) {
        let message = `${prefix}: `;
        // Add task summary
        const completedTasks = tasks.filter((t) => t.status === 'COMPLETED');
        if (completedTasks.length > 0) {
            const latestTask = completedTasks[0];
            const taskInput = latestTask.input_json ? JSON.parse(latestTask.input_json) : {};
            message += taskInput.goal || 'incremental development';
        }
        else {
            message += 'update';
        }
        // Add references
        const refs = [];
        for (const decision of decisions.slice(0, 3)) {
            refs.push(`Decision: #${decision.id} (${decision.context})`);
        }
        for (const task of tasks.slice(0, 3)) {
            refs.push(`Task: #${task.id} (${task.agent_type})`);
        }
        // Add coverage if available
        const coverageFact = facts.find((f) => f.entity === 'project' && f.attribute === 'test_coverage');
        if (coverageFact) {
            refs.push(`Coverage: ${coverageFact.value}%`);
        }
        if (refs.length > 0) {
            message += '\n\n' + refs.map((r) => `- ${r}`).join('\n');
        }
        return message;
    }
    generateTagName(milestoneName) {
        // Convert milestone name to semver tag
        const sanitized = milestoneName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
        return `v0.1.0-${sanitized}`;
    }
    // === REAL GIT EXECUTION ===
    async gitInit(cwd) {
        return this.gitSpawn(cwd, ['init']);
    }
    async executeGitCommit(cwd, message) {
        // Stage all changes
        await this.gitSpawn(cwd, ['add', '-A']);
        // Check if there are changes to commit
        const status = await this.gitSpawnWithOutput(cwd, ['status', '--porcelain']);
        if (!status.trim()) {
            throw new Error('No changes to commit');
        }
        // Commit
        await this.gitSpawn(cwd, ['commit', '-m', message]);
        // Get the commit hash
        const hash = await this.gitSpawnWithOutput(cwd, ['rev-parse', 'HEAD']);
        return { hash: hash.trim() };
    }
    async executeGitTag(cwd, tag, message) {
        await this.gitSpawn(cwd, ['tag', '-a', tag, '-m', message]);
    }
    gitSpawn(cwd, args) {
        return new Promise((resolve, reject) => {
            const child = (0, child_process_1.spawn)('git', args, { cwd });
            let stderr = '';
            child.stderr?.on('data', (data) => {
                stderr += data.toString();
            });
            child.on('close', (code) => {
                if (code === 0) {
                    resolve();
                }
                else {
                    reject(new Error(`git ${args.join(' ')} failed (exit ${code}): ${stderr}`));
                }
            });
            child.on('error', (err) => reject(err));
        });
    }
    gitSpawnWithOutput(cwd, args) {
        return new Promise((resolve, reject) => {
            const child = (0, child_process_1.spawn)('git', args, { cwd });
            let stdout = '';
            let stderr = '';
            child.stdout?.on('data', (data) => {
                stdout += data.toString();
            });
            child.stderr?.on('data', (data) => {
                stderr += data.toString();
            });
            child.on('close', (code) => {
                if (code === 0) {
                    resolve(stdout);
                }
                else {
                    reject(new Error(`git ${args.join(' ')} failed (exit ${code}): ${stderr}`));
                }
            });
            child.on('error', (err) => reject(err));
        });
    }
    // === GH CLI EXECUTION ===
    ghSpawn(args) {
        return new Promise((resolve, reject) => {
            const child = (0, child_process_1.spawn)('gh', args);
            let stderr = '';
            child.stderr?.on('data', (data) => {
                stderr += data.toString();
            });
            child.on('close', (code) => {
                if (code === 0) {
                    resolve();
                }
                else {
                    reject(new Error(`gh ${args.join(' ')} failed (exit ${code}): ${stderr}`));
                }
            });
            child.on('error', (err) => reject(err));
        });
    }
    /**
     * Get commit history from SSOT perspective
     */
    getCommitHistory(projectId, limit = 10) {
        const facts = this.store?.getCurrentFacts ? this.store.getCurrentFacts(projectId, 'git') : [];
        return facts
            .filter((f) => f.attribute === 'commit_hash')
            .slice(0, limit)
            .map((f) => ({
            hash: f.value,
            timestamp: f.valid_from,
            source: f.source,
        }));
    }
}
exports.GitAutomation = GitAutomation;
//# sourceMappingURL=git.js.map
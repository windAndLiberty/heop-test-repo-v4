import { SSOTStore } from '../ssot/store.js';
import { HEOPConfig } from '../index.js';
/**
 * Git Automation: generates Conventional Commits with SSOT references
 * Automatically tags milestones. Executes REAL git commands.
 * Supports remote repo creation via gh CLI and push to GitHub.
 */
export interface MilestoneCommitInput {
    project_id: string;
    message_prefix: string;
    milestone_name?: string;
    working_dir?: string;
    push_remote?: boolean;
    create_remote?: boolean;
    remote_name?: string;
    repo_visibility?: 'public' | 'private';
}
export interface RemoteRepoInput {
    project_id: string;
    repo_name: string;
    working_dir?: string;
    visibility?: 'public' | 'private';
    description?: string;
    push_after_create?: boolean;
}
export declare class GitAutomation {
    private store?;
    private config;
    constructor(storeOrConfig: SSOTStore | HEOPConfig, config?: HEOPConfig);
    milestoneCommit(args: MilestoneCommitInput): Promise<any>;
    /**
     * Create a remote GitHub repository using gh CLI
     */
    createRemoteRepo(args: RemoteRepoInput): Promise<any>;
    /**
     * Push local commits and tags to remote
     */
    pushToRemote(cwd: string, branch?: string): Promise<any>;
    buildCommitMessage(prefix: string, decisions: any[], tasks: any[], facts: any[]): string;
    private generateTagName;
    private gitInit;
    private executeGitCommit;
    private executeGitTag;
    private gitSpawn;
    private gitSpawnWithOutput;
    private ghSpawn;
    /**
     * Get commit history from SSOT perspective
     */
    getCommitHistory(projectId: string, limit?: number): any[];
}
//# sourceMappingURL=git.d.ts.map
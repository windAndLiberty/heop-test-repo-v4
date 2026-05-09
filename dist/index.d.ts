/**
 * HEOP - Hermes Engineering OS Plugin
 * Main entry point: registers MCP Tools, initializes SSOT, hooks into Hermes lifecycle
 */
import { SSOTStore } from './ssot/store.js';
import { SchemaManager } from './ssot/schema.js';
import { ProvenanceLogger } from './ssot/provenance.js';
import { LifecycleEngine } from './lifecycle/fsm.js';
import { DeepCodeBridge } from './bridges/deepcode.js';
import { ClaudeCodeBridge } from './bridges/claude-code.js';
import { GitAutomation } from './automation/git.js';
import { IssueAutomation } from './automation/issue.js';
export interface HEOPConfig {
    ssotDir: string;
    gitAutoCommit: boolean;
    issueProvider: 'github' | 'gitlab';
    maxConcurrentAgents: number;
    agentMemoryLimits: {
        deepcode: string;
        claudeCode: string;
    };
}
export declare class HEOPPlugin {
    private server;
    private store;
    private schema;
    private provenance;
    private lifecycle;
    private deepcodeBridge;
    private claudeCodeBridge;
    private kimiBridge;
    private gitAuto;
    private issueAuto;
    private config;
    constructor(config: HEOPConfig);
    private registerTools;
    private handleSSOTQuery;
    private handleProjectStatus;
    private registerLifecycleHooks;
    start(): Promise<void>;
    initProject(args: any): Promise<any>;
    /**
     * Adopt an existing project into HEOP SSOT
     * Scans codebase, extracts decisions from code/comments, records initial state
     * Skips cold-start (CREATED -> PLANNED -> BOOTSTRAPPED), enters ADOPTED state
     */
    adoptProject(args: any): Promise<any>;
    private scanCodebase;
    private detectTechStack;
    private inferDecisions;
    private getGitInfo;
    deepcodeBootstrap(args: any): Promise<any>;
    claudeCodeIncremental(args: any): Promise<any>;
    kimiExecute(args: any): Promise<any>;
    gitMilestoneCommit(args: any): Promise<any>;
    createRemoteRepo(args: any): Promise<any>;
    ssotQuery(args: any): Promise<any>;
    projectStatus(args: any): Promise<any>;
}
export default HEOPPlugin;
export { SSOTStore, SchemaManager, ProvenanceLogger, LifecycleEngine };
export { DeepCodeBridge, ClaudeCodeBridge };
export { GitAutomation, IssueAutomation };
//# sourceMappingURL=index.d.ts.map
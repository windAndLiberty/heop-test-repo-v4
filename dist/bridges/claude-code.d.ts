import { SSOTStore } from '../ssot/store.js';
import { ProvenanceLogger } from '../ssot/provenance.js';
import { HEOPConfig } from '../index.js';
/**
 * Claude Code Bridge: handles incremental development tasks
 * Spawns isolated Claude Code CLI with memory limits via Kimi API
 * READ-ONLY access to decisions table to prevent local optimization breaking global architecture
 */
export interface ClaudeCodeInput {
    project_id: string;
    task_id: string;
    goal: string;
    context_facts_query?: string;
    readonly_files?: string[];
    working_dir?: string;
}
export interface ClaudeCodeOutput {
    success: boolean;
    diff?: string;
    test_results?: {
        passed: boolean;
        coverage?: number;
        details?: string;
    };
    summary?: string;
    error?: string;
}
export declare class ClaudeCodeBridge {
    private store;
    private provenance;
    private config;
    constructor(storeOrConfig: SSOTStore | HEOPConfig, provenanceOrConfig?: ProvenanceLogger | HEOPConfig, config?: HEOPConfig);
    execute(args: ClaudeCodeInput): Promise<any>;
    /**
     * Assemble context package from SSOT for Claude Code
     * READ-ONLY access to decisions table
     */
    private assembleContextPackage;
    private spawnClaudeCode;
    private generateFallbackOutput;
    private parseClaudeOutput;
    private applyDiff;
}
//# sourceMappingURL=claude-code.d.ts.map
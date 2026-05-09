import { SSOTStore } from '../ssot/store.js';
import { ProvenanceLogger } from '../ssot/provenance.js';
import { HEOPConfig } from '../index.js';
/**
 * DeepCode Bridge: handles cold-start project bootstrapping
 *
 * NOTE: The local 'deepcode' binary is deepcode-hku, a paper reproduction engine
 * that requires Docker and specific project structure. It is NOT a general
 * code generation tool. This bridge implements fallback code generation using
 * Claude Code (via Kimi API) as the actual bootstrap mechanism.
 *
 * The 'deepcode_bootstrap' MCP tool name is preserved for API compatibility.
 */
export interface DeepCodeInput {
    project_id: string;
    requirements_dir: string;
    constraints_json?: string;
    working_dir?: string;
}
export interface DeepCodeOutput {
    success: boolean;
    report_path?: string;
    generated_dir?: string;
    decisions?: Array<{
        context: string;
        choice: string;
        rationale: string;
        confidence: number;
    }>;
    error?: string;
}
export declare class DeepCodeBridge {
    private store;
    private provenance;
    private config;
    constructor(storeOrConfig: SSOTStore | HEOPConfig, provenanceOrConfig?: ProvenanceLogger | HEOPConfig, config?: HEOPConfig);
    execute(args: DeepCodeInput): Promise<any>;
    bootstrap(args: DeepCodeInput): Promise<any>;
    private parseRequirements;
    private inferPriority;
    private spawnBootstrapAgent;
    private tryDeepCodeHku;
    private spawnClaudeBootstrap;
    private generatePaperMd;
    private generateFallbackOutput;
    private extractDecisions;
    private initGit;
}
//# sourceMappingURL=deepcode.d.ts.map
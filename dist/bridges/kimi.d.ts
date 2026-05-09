import { SSOTStore } from '../ssot/store.js';
import { ProvenanceLogger } from '../ssot/provenance.js';
import { HEOPConfig } from '../index.js';
/**
 * Kimi Bridge: 直接调用 Kimi API (OpenAI-compatible) 进行代码生成和增量开发
 * 不依赖 Claude Code CLI，直接通过 HTTP API 调用 Kimi 模型
 * 用于轻量级任务、快速代码生成、以及作为 Claude Code Bridge 的替代方案
 */
export interface KimiInput {
    project_id: string;
    task_id?: string;
    goal: string;
    context_facts_query?: string;
    readonly_files?: string[];
    working_dir?: string;
    model?: string;
    temperature?: number;
    max_tokens?: number;
}
export interface KimiOutput {
    success: boolean;
    generated_files?: Array<{
        path: string;
        content: string;
    }>;
    diff?: string;
    summary?: string;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
    error?: string;
}
export declare class KimiBridge {
    private store;
    private provenance;
    private config;
    private apiKey;
    private baseUrl;
    constructor(storeOrConfig: SSOTStore | HEOPConfig, provenanceOrConfig?: ProvenanceLogger | HEOPConfig, config?: HEOPConfig);
    execute(args: KimiInput): Promise<any>;
    private assembleContextPackage;
    private callKimiAPI;
    private parseGeneratedFiles;
    private extractSummary;
    /**
     * Quick code generation without full context assembly
     * Useful for simple tasks like "generate a README" or "create a config file"
     */
    quickGenerate(args: {
        prompt: string;
        working_dir?: string;
        model?: string;
        output_file?: string;
    }): Promise<string>;
}
//# sourceMappingURL=kimi.d.ts.map
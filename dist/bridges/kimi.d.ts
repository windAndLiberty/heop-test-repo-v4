import { SSOTStore } from '../ssot/store.js';
import { ProvenanceLogger } from '../ssot/provenance.js';
import { HEOPConfig } from '../index.js';
/**
 * Kimi Bridge: 调用本地 kimi CLI 命令进行代码生成和增量开发
 * 用户已在终端配置好默认模型 (kimi-for-coding)，直接执行 `kimi` 命令即可
 * 不依赖 HTTP API 或 Claude Code CLI
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
    constructor(storeOrConfig: SSOTStore | HEOPConfig, provenanceOrConfig?: ProvenanceLogger | HEOPConfig, config?: HEOPConfig);
    execute(args: KimiInput): Promise<any>;
    private assembleContextPackage;
    private callKimiCLI;
    private parseGeneratedFiles;
    private extractSummary;
    /**
     * Quick code generation without full context assembly
     * Useful for simple tasks like "generate a README" or "create a config file"
     * Uses local kimi CLI (model already configured by user)
     */
    quickGenerate(args: {
        prompt: string;
        working_dir?: string;
        model?: string;
        output_file?: string;
    }): Promise<string>;
}
//# sourceMappingURL=kimi.d.ts.map
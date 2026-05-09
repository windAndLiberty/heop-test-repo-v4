import { SchemaManager } from './schema.js';
/**
 * Provenance Logger: records the origin and reasoning chain of every fact
 * Enables XAI (Explainable AI) - answering "why was this decision made?"
 */
export interface ProvenanceRecord {
    id?: string;
    fact_id: string;
    operation: 'CREATE' | 'INVALIDATE' | 'UPDATE';
    actor: 'deepcode' | 'claude' | 'hermes' | 'kimi' | 'human';
    input_context: string;
    reasoning_chain?: string;
    timestamp?: number;
}
export declare class ProvenanceLogger {
    private schema;
    constructor(schemaOrDir: SchemaManager | string);
    /**
     * Log a provenance record for a fact operation
     */
    log(projectId: string, record: Omit<ProvenanceRecord, 'id' | 'timestamp'>): string;
    /**
     * Get full provenance chain for a fact
     */
    getProvenanceChain(projectId: string, factId: string): any[];
    /**
     * Get provenance for a decision (including parent decisions)
     */
    getDecisionProvenance(projectId: string, decisionId: string): any;
    private getParentDecisionChain;
    /**
     * Log fact creation with full context
     */
    logProvenance(projectId: string, factId: string, operation: 'CREATE' | 'INVALIDATE' | 'UPDATE', actor: 'deepcode' | 'claude' | 'hermes' | 'kimi' | 'human', inputContext: string, reasoningChain?: string): string;
    getProvenance(projectId: string, factId: string): any[];
    logFactInvalidation(projectId: string, factId: string, actor: 'deepcode' | 'claude' | 'hermes' | 'kimi' | 'human', inputContext: string): string;
    /**
     * Generate human-readable explanation for a decision
     */
    explainDecision(projectId: string, decisionId: string): string;
}
//# sourceMappingURL=provenance.d.ts.map
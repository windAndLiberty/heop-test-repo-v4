"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProvenanceLogger = void 0;
const schema_js_1 = require("./schema.js");
class ProvenanceLogger {
    schema;
    constructor(schemaOrDir) {
        if (typeof schemaOrDir === 'string') {
            this.schema = new schema_js_1.SchemaManager(schemaOrDir);
        }
        else {
            this.schema = schemaOrDir;
        }
    }
    /**
     * Log a provenance record for a fact operation
     */
    log(projectId, record) {
        const db = this.schema.getConnection(projectId);
        const id = `prov_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const now = Math.floor(Date.now() / 1000);
        const stmt = db.prepare(`
      INSERT INTO provenance (id, fact_id, operation, actor, input_context, reasoning_chain, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
        stmt.run(id, record.fact_id, record.operation, record.actor, record.input_context, record.reasoning_chain || null, now);
        return id;
    }
    /**
     * Get full provenance chain for a fact
     */
    getProvenanceChain(projectId, factId) {
        const db = this.schema.getConnection(projectId);
        const stmt = db.prepare(`
      SELECT * FROM provenance 
      WHERE fact_id = ? 
      ORDER BY timestamp DESC
    `);
        return stmt.all(factId);
    }
    /**
     * Get provenance for a decision (including parent decisions)
     */
    getDecisionProvenance(projectId, decisionId) {
        const db = this.schema.getConnection(projectId);
        // Get the decision itself
        const decision = db.prepare('SELECT * FROM decisions WHERE id = ?').get(decisionId);
        if (!decision)
            return null;
        // Get provenance records for this decision
        const provenance = db.prepare(`
      SELECT * FROM provenance 
      WHERE fact_id = ? 
      ORDER BY timestamp DESC
    `).all(decisionId);
        // Recursively get parent decision if exists
        let parentChain = [];
        if (decision.parent_decision_id) {
            parentChain = this.getParentDecisionChain(projectId, decision.parent_decision_id);
        }
        return {
            decision,
            provenance,
            parentChain,
        };
    }
    getParentDecisionChain(projectId, parentId) {
        const db = this.schema.getConnection(projectId);
        const chain = [];
        let currentId = parentId;
        while (currentId) {
            const decision = db.prepare('SELECT * FROM decisions WHERE id = ?').get(currentId);
            if (!decision)
                break;
            const provenance = db.prepare(`
        SELECT * FROM provenance WHERE fact_id = ? ORDER BY timestamp DESC
      `).all(currentId);
            chain.push({ decision, provenance });
            currentId = decision.parent_decision_id;
        }
        return chain;
    }
    /**
     * Log fact creation with full context
     */
    logProvenance(projectId, factId, operation, actor, inputContext, reasoningChain) {
        return this.log(projectId, {
            fact_id: factId,
            operation,
            actor,
            input_context: inputContext,
            reasoning_chain: reasoningChain,
        });
    }
    getProvenance(projectId, factId) {
        return this.getProvenanceChain(projectId, factId);
    }
    logFactInvalidation(projectId, factId, actor, inputContext) {
        return this.log(projectId, {
            fact_id: factId,
            operation: 'INVALIDATE',
            actor,
            input_context: inputContext,
        });
    }
    /**
     * Generate human-readable explanation for a decision
     */
    explainDecision(projectId, decisionId) {
        const data = this.getDecisionProvenance(projectId, decisionId);
        if (!data)
            return `Decision ${decisionId} not found.`;
        const { decision, provenance, parentChain } = data;
        let explanation = `## Decision: ${decision.context}\n\n`;
        explanation += `**Choice:** ${decision.choice}\n`;
        explanation += `**Rationale:** ${decision.rationale}\n`;
        explanation += `**Confidence:** ${(decision.confidence * 100).toFixed(1)}%\n`;
        explanation += `**Source Agent:** ${decision.source_agent}\n`;
        explanation += `**Created:** ${new Date(decision.created_at * 1000).toISOString()}\n\n`;
        if (provenance && provenance.length > 0) {
            explanation += `### Provenance Log\n`;
            for (const prov of provenance) {
                explanation += `- **${prov.operation}** by ${prov.actor} at ${new Date(prov.timestamp * 1000).toISOString()}\n`;
                explanation += `  - Input: ${prov.input_context}\n`;
                if (prov.reasoning_chain) {
                    explanation += `  - Reasoning: ${prov.reasoning_chain}\n`;
                }
            }
        }
        if (parentChain && parentChain.length > 0) {
            explanation += `\n### Parent Decision Chain\n`;
            for (const parent of parentChain) {
                explanation += `- ${parent.decision.context}: ${parent.decision.choice} (${parent.decision.rationale})\n`;
            }
        }
        return explanation;
    }
}
exports.ProvenanceLogger = ProvenanceLogger;
//# sourceMappingURL=provenance.js.map
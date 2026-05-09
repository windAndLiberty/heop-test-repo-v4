import { SchemaManager } from './schema.js';
/**
 * SSOT Store: Single Source of Truth data access layer
 * Enforces immutable append-only updates and event sourcing discipline
 */
export interface FactRecord {
    id: string;
    project_id: string;
    entity: string;
    attribute: string;
    value: string;
    value_type?: string;
    confidence?: number;
    source?: string;
    valid_from?: number;
    valid_until?: number;
}
export interface DecisionRecord {
    id: string;
    project_id: string;
    context: string;
    choice: string;
    rationale: string;
    confidence: number;
    source_agent: string;
    parent_decision_id?: string;
    created_at?: number;
}
export interface TaskRecord {
    id: string;
    project_id: string;
    requirement_id?: string;
    agent_type: 'deepcode' | 'claude' | 'hermes';
    status: string;
    input_json?: string;
    output_json?: string;
    error_log?: string;
    git_commit_hash?: string;
    created_at?: number;
    started_at?: number;
    completed_at?: number;
}
export interface MilestoneRecord {
    id: string;
    project_id: string;
    name: string;
    criteria_json: string;
    achieved_at?: number;
    git_tag?: string;
    evidence_json?: string;
}
export declare class SSOTStore {
    private schema;
    constructor(schemaOrDir: SchemaManager | string);
    createProject(projectId: string, name: string, goal?: string): void;
    getProject(projectId: string): any;
    updateProjectState(projectId: string, newState: string): void;
    addFact(projectId: string, entity: string, attribute: string, value: string, valueType?: string, confidence?: number, source?: string): string;
    /**
     * Insert a new fact. If a fact with same entity+attribute exists,
     * invalidate the old one first (event sourcing discipline).
     */
    insertFact(projectId: string, fact: Omit<FactRecord, 'id' | 'project_id' | 'valid_from'>): string;
    getCurrentFacts(projectId: string, entity?: string, attribute?: string): any[];
    getFactHistory(projectId: string, entity: string, attribute: string): any[];
    addDecision(projectId: string, context: string, choice: string, rationale: string, confidence: number, sourceAgent: string, parentDecisionId?: string): string;
    insertDecision(projectId: string, decision: Omit<DecisionRecord, 'id' | 'project_id' | 'created_at'>): string;
    getDecisions(projectId: string, context?: string): any[];
    addRequirement(projectId: string, sourceFile: string, text: string, status?: string, priority?: number): string;
    insertRequirement(projectId: string, req: {
        id?: string;
        source_file?: string;
        text: string;
        status?: string;
        priority?: number;
    }): string;
    getRequirements(projectId: string, status?: string): any[];
    createTask(projectId: string, task: Omit<TaskRecord, 'id' | 'project_id' | 'created_at'>): string;
    updateTask(taskId: string, projectId: string, updates: Partial<TaskRecord>): void;
    /**
     * Convenience method: update task by ID only (searches across all projects)
     * Note: This is slower than updateTask with projectId. Prefer the 3-arg version.
     */
    updateTaskById(taskId: string, updates: Partial<TaskRecord>): void;
    getTaskById(taskId: string): any | null;
    getTasks(projectId: string, limit?: number): any[];
    getRecentTasks(projectId: string, limit?: number): any[];
    addMilestone(projectId: string, name: string, criteriaJson: string): string;
    createMilestone(projectId: string, milestone: Omit<MilestoneRecord, 'id' | 'project_id'>): string;
    achieveMilestone(milestoneId: string, projectId: string, evidence?: any): void;
    updateMilestone(milestoneId: string, updates: {
        achieved_at?: number;
        git_tag?: string;
        evidence_json?: string;
    }): void;
    getMilestones(projectId: string): any[];
    getFacts(projectId: string, entity: string, attribute: string): any[];
    getAllFacts(projectId: string, entity?: string): any[];
    query(projectId: string, table: string, filters?: Record<string, any>, limit?: number): any[];
    getProjectStatus(projectId: string): any;
}
//# sourceMappingURL=store.d.ts.map
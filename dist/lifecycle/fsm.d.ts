import { SSOTStore } from '../ssot/store.js';
import { ProvenanceLogger } from '../ssot/provenance.js';
/**
 * Lifecycle Engine: Finite State Machine (FSM) for project lifecycle management
 * Automatically transitions project states based on task completion and criteria
 */
export type ProjectState = 'CREATED' | 'PLANNED' | 'BOOTSTRAPPED' | 'INCREMENTAL_DEV' | 'TESTING' | 'DELIVERED' | 'ARCHIVED' | 'ADOPTED';
export interface StateTransition {
    from: ProjectState;
    to: ProjectState;
    condition: string;
    evaluator: (projectId: string, store: SSOTStore, context?: any) => boolean;
    sideEffects?: (projectId: string, store: SSOTStore, provenance: ProvenanceLogger) => Promise<void>;
}
export declare class LifecycleEngine {
    private store;
    private provenance;
    private transitions;
    constructor(ssotDirOrStore: string | SSOTStore, provenance?: ProvenanceLogger);
    initProject(projectId: string): void;
    private defineTransitions;
    /**
     * Evaluate if a state transition should occur (returns transition without executing)
     */
    evaluateTransition(projectId: string, store?: SSOTStore): StateTransition | null;
    /**
     * Execute a transition to a specific state
     */
    transitionTo(projectId: string, toState: ProjectState, store?: SSOTStore): Promise<void>;
    /**
     * Evaluate if a state transition should occur after a task completes
     */
    evaluateAndTransition(projectId: string, taskContext?: any): Promise<ProjectState | null>;
    /**
     * Get current state and available next states
     */
    getStateInfo(projectId: string): {
        current: ProjectState;
        possibleNext: StateTransition[];
    };
    /**
     * Force a state transition (for manual override or recovery)
     */
    forceTransition(projectId: string, toState: ProjectState, reason: string): void;
    getCurrentState(projectId: string): string;
    private gitTag;
}
//# sourceMappingURL=fsm.d.ts.map
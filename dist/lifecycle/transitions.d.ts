import { ProjectState } from './fsm.js';
/**
 * Transition Rules: declarative definitions of state transition conditions
 * Separated from FSM engine for easier customization and testing
 */
export interface TransitionRule {
    from: ProjectState;
    to: ProjectState;
    name: string;
    description: string;
    requiredFacts: {
        entity: string;
        attribute: string;
        expectedValue?: string;
    }[];
    requiredTasks: {
        agentType: string;
        status: string;
        minCount?: number;
    }[];
    requiredMilestones?: string[];
    customCheck?: string;
}
export declare class TransitionRules {
    private rules;
    constructor();
    private defineRules;
    getRules(): TransitionRule[];
    getRulesFrom(state: ProjectState): TransitionRule[];
    getRule(from: ProjectState, to: ProjectState): TransitionRule | undefined;
    /**
     * Add custom transition rule at runtime
     */
    addRule(rule: TransitionRule): void;
    /**
     * Validate a rule definition
     */
    validateRule(rule: TransitionRule): string[];
}
//# sourceMappingURL=transitions.d.ts.map
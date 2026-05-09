"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransitionRules = void 0;
class TransitionRules {
    rules;
    constructor() {
        this.rules = this.defineRules();
    }
    defineRules() {
        return [
            {
                from: 'CREATED',
                to: 'PLANNED',
                name: 'plan_complete',
                description: 'PRD parsed and architecture decisions recorded',
                requiredFacts: [
                    { entity: 'project', attribute: 'prd_parsed', expectedValue: 'true' },
                ],
                requiredTasks: [
                    { agentType: 'deepcode', status: 'COMPLETED', minCount: 1 },
                ],
            },
            {
                from: 'PLANNED',
                to: 'BOOTSTRAPPED',
                name: 'skeleton_ready',
                description: 'Code skeleton generated and builds successfully',
                requiredFacts: [
                    { entity: 'project', attribute: 'build_status', expectedValue: 'success' },
                    { entity: 'project', attribute: 'docker_health', expectedValue: 'healthy' },
                ],
                requiredTasks: [
                    { agentType: 'deepcode', status: 'COMPLETED', minCount: 1 },
                ],
            },
            {
                from: 'BOOTSTRAPPED',
                to: 'INCREMENTAL_DEV',
                name: 'dev_started',
                description: 'First incremental feature completed by Claude Code',
                requiredFacts: [],
                requiredTasks: [
                    { agentType: 'claude', status: 'COMPLETED', minCount: 1 },
                ],
            },
            {
                from: 'INCREMENTAL_DEV',
                to: 'TESTING',
                name: 'tests_passing',
                description: 'All tests passing, ready for QA',
                requiredFacts: [
                    { entity: 'project', attribute: 'test_status', expectedValue: 'all_passed' },
                ],
                requiredTasks: [],
            },
            {
                from: 'TESTING',
                to: 'DELIVERED',
                name: 'all_milestones_achieved',
                description: 'All milestones completed',
                requiredFacts: [],
                requiredTasks: [],
                requiredMilestones: [], // Empty means all defined milestones must be achieved
            },
        ];
    }
    getRules() {
        return this.rules;
    }
    getRulesFrom(state) {
        return this.rules.filter(r => r.from === state);
    }
    getRule(from, to) {
        return this.rules.find(r => r.from === from && r.to === to);
    }
    /**
     * Add custom transition rule at runtime
     */
    addRule(rule) {
        // Check for conflicts
        const existing = this.rules.find(r => r.from === rule.from && r.to === rule.to);
        if (existing) {
            throw new Error(`Transition ${rule.from} -> ${rule.to} already exists`);
        }
        this.rules.push(rule);
    }
    /**
     * Validate a rule definition
     */
    validateRule(rule) {
        const errors = [];
        if (!rule.from || !rule.to) {
            errors.push('From and To states are required');
        }
        if (rule.from === rule.to) {
            errors.push('From and To states cannot be the same');
        }
        if (!rule.name) {
            errors.push('Rule name is required');
        }
        if (!rule.requiredFacts?.length && !rule.requiredTasks?.length && !rule.requiredMilestones) {
            errors.push('At least one condition (facts, tasks, or milestones) is required');
        }
        return errors;
    }
}
exports.TransitionRules = TransitionRules;
//# sourceMappingURL=transitions.js.map
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LifecycleEngine = void 0;
const store_js_1 = require("../ssot/store.js");
const provenance_js_1 = require("../ssot/provenance.js");
class LifecycleEngine {
    store;
    provenance;
    transitions;
    constructor(ssotDirOrStore, provenance) {
        if (typeof ssotDirOrStore === 'string') {
            this.store = new store_js_1.SSOTStore(ssotDirOrStore);
            this.provenance = provenance || new provenance_js_1.ProvenanceLogger(ssotDirOrStore);
        }
        else {
            this.store = ssotDirOrStore;
            this.provenance = provenance || new provenance_js_1.ProvenanceLogger(ssotDirOrStore.schema || '/tmp/heop-default');
        }
        this.transitions = this.defineTransitions();
    }
    initProject(projectId) {
        // Ensure project state is CREATED
        const project = this.store.getProject(projectId);
        if (project && project.state !== 'CREATED') {
            this.store.updateProjectState(projectId, 'CREATED');
        }
    }
    defineTransitions() {
        return [
            // --- 冷启动路径（空项目） ---
            {
                from: 'CREATED',
                to: 'PLANNED',
                condition: 'PRD解析完成，DeepCode Planning Agent返回架构报告',
                evaluator: (projectId, store) => {
                    const reqs = store.getRequirements(projectId);
                    const decisions = store.getDecisions(projectId);
                    return reqs.length > 0 && decisions.length > 0;
                },
            },
            {
                from: 'PLANNED',
                to: 'BOOTSTRAPPED',
                condition: 'DeepCode生成代码通过编译 + Docker健康检查',
                evaluator: (projectId, store) => {
                    const facts = store.getCurrentFacts(projectId, 'project', 'build_status');
                    const latestBuild = facts[0];
                    return latestBuild?.value === 'success';
                },
                sideEffects: async (projectId, store, provenance) => {
                    // Tag v0.1.0-skeleton
                    await this.gitTag(projectId, 'v0.1.0-skeleton', 'Initial project skeleton');
                    // Record milestone achievement
                    const milestones = store.getMilestones(projectId);
                    const skeletonMs = milestones.find((m) => m.name === 'Skeleton Delivered');
                    if (skeletonMs) {
                        store.achieveMilestone(skeletonMs.id, projectId, {
                            reason: 'Build successful, Docker health check passed',
                        });
                    }
                },
            },
            // --- 现有项目路径（跳过冷启动） ---
            {
                from: 'ADOPTED',
                to: 'INCREMENTAL_DEV',
                condition: '现有项目已接纳，代码库已扫描，可直接增量开发',
                evaluator: (projectId, store) => {
                    // 只要已记录代码扫描事实，即可进入增量开发
                    const facts = store.getCurrentFacts(projectId, 'project', 'codebase_scanned');
                    return facts.length > 0;
                },
            },
            // --- 通用路径 ---
            {
                from: 'BOOTSTRAPPED',
                to: 'INCREMENTAL_DEV',
                condition: '首个功能需求委派给Claude Code',
                evaluator: (projectId, store) => {
                    const tasks = store.getTasks(projectId, 10);
                    return tasks.some((t) => (t.agent_type === 'claude' || t.agent_type === 'kimi') && t.status === 'COMPLETED');
                },
            },
            {
                from: 'INCREMENTAL_DEV',
                to: 'TESTING',
                condition: 'Claude Code返回全部测试通过',
                evaluator: (projectId, store) => {
                    const facts = store.getCurrentFacts(projectId, 'project', 'test_status');
                    const latestTest = facts[0];
                    return latestTest?.value === 'all_passed';
                },
            },
            {
                from: 'TESTING',
                to: 'DELIVERED',
                condition: '所有里程碑达成',
                evaluator: (projectId, store) => {
                    const milestones = store.getMilestones(projectId);
                    if (milestones.length === 0)
                        return false;
                    return milestones.every((m) => m.achieved_at !== null);
                },
                sideEffects: async (projectId, store, provenance) => {
                    // Tag v1.0.0
                    await this.gitTag(projectId, 'v1.0.0', 'Project delivered');
                    // Generate delivery report
                    const status = store.getProjectStatus(projectId);
                    console.log(`Project ${projectId} delivered! Status:`, JSON.stringify(status, null, 2));
                },
            },
        ];
    }
    /**
     * Evaluate if a state transition should occur (returns transition without executing)
     */
    evaluateTransition(projectId, store) {
        const project = (store || this.store).getProject(projectId);
        if (!project) {
            throw new Error(`Project ${projectId} not found`);
        }
        const currentState = project.state;
        // Find applicable transitions from current state
        const applicableTransitions = this.transitions.filter(t => t.from === currentState);
        for (const transition of applicableTransitions) {
            const shouldTransition = transition.evaluator(projectId, store || this.store);
            if (shouldTransition) {
                return transition;
            }
        }
        return null; // No transition available
    }
    /**
     * Execute a transition to a specific state
     */
    async transitionTo(projectId, toState, store) {
        const fromState = this.getCurrentState(projectId);
        // Update project state
        (store || this.store).updateProjectState(projectId, toState);
        // Record the state change as a fact
        const factId = (store || this.store).insertFact(projectId, {
            entity: 'project',
            attribute: 'state',
            value: toState,
            source: 'hermes-lifecycle',
            value_type: 'string',
        });
        // Log provenance
        this.provenance.logProvenance(projectId, factId, 'CREATE', 'hermes', `State transition: ${fromState} -> ${toState}`, `Manual or evaluated transition`);
        console.log(`Project ${projectId} transitioned: ${fromState} -> ${toState}`);
    }
    /**
     * Evaluate if a state transition should occur after a task completes
     */
    async evaluateAndTransition(projectId, taskContext) {
        const project = this.store.getProject(projectId);
        if (!project) {
            throw new Error(`Project ${projectId} not found`);
        }
        const currentState = project.state;
        // Find applicable transitions from current state
        const applicableTransitions = this.transitions.filter(t => t.from === currentState);
        for (const transition of applicableTransitions) {
            const shouldTransition = transition.evaluator(projectId, this.store, taskContext);
            if (shouldTransition) {
                // Execute transition
                this.store.updateProjectState(projectId, transition.to);
                // Record the state change as a fact
                const factId = this.store.insertFact(projectId, {
                    entity: 'project',
                    attribute: 'state',
                    value: transition.to,
                    source: 'hermes-lifecycle',
                    value_type: 'string',
                });
                // Log provenance
                this.provenance.logProvenance(projectId, factId, 'CREATE', 'hermes', `State transition: ${transition.from} -> ${transition.to}`, `Condition: ${transition.condition}`);
                // Execute side effects
                if (transition.sideEffects) {
                    await transition.sideEffects(projectId, this.store, this.provenance);
                }
                console.log(`Project ${projectId} transitioned: ${transition.from} -> ${transition.to}`);
                return transition.to;
            }
        }
        return null; // No transition occurred
    }
    /**
     * Get current state and available next states
     */
    getStateInfo(projectId) {
        const project = this.store.getProject(projectId);
        const current = (project?.state || 'CREATED');
        const possibleNext = this.transitions.filter(t => t.from === current);
        return { current, possibleNext };
    }
    /**
     * Force a state transition (for manual override or recovery)
     */
    forceTransition(projectId, toState, reason) {
        const project = this.store.getProject(projectId);
        const fromState = project?.state || 'CREATED';
        this.store.updateProjectState(projectId, toState);
        const factId = this.store.insertFact(projectId, {
            entity: 'project',
            attribute: 'state',
            value: toState,
            source: 'human-override',
            value_type: 'string',
        });
        this.provenance.logProvenance(projectId, factId, 'CREATE', 'human', `Manual state override: ${fromState} -> ${toState}`, reason);
    }
    getCurrentState(projectId) {
        const project = this.store.getProject(projectId);
        return project?.state || 'CREATED';
    }
    async gitTag(projectId, tag, message) {
        // This would integrate with GitAutomation
        // For now, record it as a fact
        this.store.insertFact(projectId, {
            entity: 'git',
            attribute: 'tag',
            value: tag,
            source: 'hermes-lifecycle',
            value_type: 'string',
        });
        console.log(`[Lifecycle] Git tag created: ${tag} - ${message}`);
    }
}
exports.LifecycleEngine = LifecycleEngine;
//# sourceMappingURL=fsm.js.map
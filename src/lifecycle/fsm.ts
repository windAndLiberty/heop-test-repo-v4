import { SSOTStore } from '../ssot/store.js';
import { ProvenanceLogger } from '../ssot/provenance.js';

/**
 * Lifecycle Engine: Finite State Machine (FSM) for project lifecycle management
 * Automatically transitions project states based on task completion and criteria
 */

export type ProjectState = 
  | 'CREATED' 
  | 'PLANNED' 
  | 'BOOTSTRAPPED' 
  | 'INCREMENTAL_DEV' 
  | 'TESTING' 
  | 'DELIVERED' 
  | 'ARCHIVED';

export interface StateTransition {
  from: ProjectState;
  to: ProjectState;
  condition: string;  // Human-readable condition description
  evaluator: (projectId: string, store: SSOTStore, context?: any) => boolean;
  sideEffects?: (projectId: string, store: SSOTStore, provenance: ProvenanceLogger) => Promise<void>;
}

export class LifecycleEngine {
  private store: SSOTStore;
  private provenance: ProvenanceLogger;
  private transitions: StateTransition[];

  constructor(ssotDirOrStore: string | SSOTStore, provenance?: ProvenanceLogger) {
    if (typeof ssotDirOrStore === 'string') {
      this.store = new SSOTStore(ssotDirOrStore);
      this.provenance = provenance || new ProvenanceLogger(ssotDirOrStore);
    } else {
      this.store = ssotDirOrStore;
      this.provenance = provenance || new ProvenanceLogger((ssotDirOrStore as any).schema || '/tmp/heop-default');
    }
    this.transitions = this.defineTransitions();
  }

  initProject(projectId: string): void {
    // Ensure project state is CREATED
    const project = this.store.getProject(projectId);
    if (project && project.state !== 'CREATED') {
      this.store.updateProjectState(projectId, 'CREATED');
    }
  }

  private defineTransitions(): StateTransition[] {
    return [
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
          const skeletonMs = milestones.find((m: any) => m.name === 'Skeleton Delivered');
          if (skeletonMs) {
            store.achieveMilestone(skeletonMs.id, projectId, {
              reason: 'Build successful, Docker health check passed',
            });
          }
        },
      },
      {
        from: 'BOOTSTRAPPED',
        to: 'INCREMENTAL_DEV',
        condition: '首个功能需求委派给Claude Code',
        evaluator: (projectId, store) => {
          const tasks = store.getTasks(projectId, 10);
          return tasks.some((t: any) => t.agent_type === 'claude' && t.status === 'COMPLETED');
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
          if (milestones.length === 0) return false;
          return milestones.every((m: any) => m.achieved_at !== null);
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
  evaluateTransition(projectId: string, store?: SSOTStore): StateTransition | null {
    const project = (store || this.store).getProject(projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }

    const currentState = project.state as ProjectState;
    
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
  async transitionTo(projectId: string, toState: ProjectState, store?: SSOTStore): Promise<void> {
    const fromState = this.getCurrentState(projectId) as ProjectState;
    
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
    this.provenance.logProvenance(
      projectId,
      factId,
      'CREATE',
      'hermes',
      `State transition: ${fromState} -> ${toState}`,
      `Manual or evaluated transition`
    );

    console.log(`Project ${projectId} transitioned: ${fromState} -> ${toState}`);
  }

  /**
   * Evaluate if a state transition should occur after a task completes
   */
  async evaluateAndTransition(projectId: string, taskContext?: any): Promise<ProjectState | null> {
    const project = this.store.getProject(projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }

    const currentState = project.state as ProjectState;
    
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
        this.provenance.logProvenance(
          projectId,
          factId,
          'CREATE',
          'hermes',
          `State transition: ${transition.from} -> ${transition.to}`,
          `Condition: ${transition.condition}`
        );

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
  getStateInfo(projectId: string): { current: ProjectState; possibleNext: StateTransition[] } {
    const project = this.store.getProject(projectId);
    const current = (project?.state || 'CREATED') as ProjectState;
    const possibleNext = this.transitions.filter(t => t.from === current);
    
    return { current, possibleNext };
  }

  /**
   * Force a state transition (for manual override or recovery)
   */
  forceTransition(projectId: string, toState: ProjectState, reason: string): void {
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
    
    this.provenance.logProvenance(
      projectId,
      factId,
      'CREATE',
      'human',
      `Manual state override: ${fromState} -> ${toState}`,
      reason
    );
  }

  getCurrentState(projectId: string): string {
    const project = this.store.getProject(projectId);
    return project?.state || 'CREATED';
  }

  private async gitTag(projectId: string, tag: string, message: string): Promise<void> {
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

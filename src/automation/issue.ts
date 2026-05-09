import { SSOTStore } from '../ssot/store.js';
import { HEOPConfig } from '../index.js';

/**
 * Issue Automation: creates structured GitHub/GitLab issues from SSOT data
 * Triggered when tasks fail or state machine blocks
 */

export interface StructuredIssueInput {
  project_id: string;
  title: string;
  task_id: string;
  labels?: string[];
}

export interface IssueBody {
  title: string;
  body: string;
  labels: string[];
  metadata: {
    project_id: string;
    task_id: string;
    related_decisions: string[];
    suggested_next_steps: string[];
  };
}

export class IssueAutomation {
  private store?: SSOTStore;
  private config: HEOPConfig;

  constructor(storeOrConfig: SSOTStore | HEOPConfig, config?: HEOPConfig) {
    if (config) {
      this.store = storeOrConfig as SSOTStore;
      this.config = config;
    } else {
      this.config = storeOrConfig as HEOPConfig;
    }
  }

  async createStructuredIssue(args: StructuredIssueInput): Promise<any> {
    const { project_id, title, task_id, labels = ['heop', 'auto-generated'] } = args;

    try {
      // Gather data from SSOT
      const issueData = this.assembleIssueData(project_id, task_id);

      // Build structured body
      const body = this.buildIssueBody(issueData);

      // In production, this would call GitHub/GitLab API
      const issueResult = await this.createIssue(
        title,
        body,
        labels
      );

      // Record in SSOT
      if (this.store) {
        this.store.insertFact(project_id, {
          entity: 'issue',
          attribute: 'created',
          value: issueResult.url || 'simulated',
          source: 'hermes-issue-auto',
          value_type: 'string',
        });
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                title,
                provider: this.config.issueProvider,
                labels,
                url: issueResult.url,
                related_decisions: issueData.relatedDecisions.map((d: any) => d.id),
                suggested_next_steps: issueData.suggestedNextSteps,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: `Issue creation failed: ${errorMsg}`,
          },
        ],
        isError: true,
      };
    }
  }

  private assembleIssueData(projectId: string, taskId: string): any {
    const project = this.store ? this.store.getProject(projectId) : null;
    const task = this.store
      ? this.store.getTasks(projectId).find((t: any) => t.id === taskId)
      : null;
    const decisions = this.store ? this.store.getDecisions(projectId) : [];
    const milestones = this.store ? this.store.getMilestones(projectId) : [];

    // Find related decisions (heuristic: decisions created around same time as task)
    const taskTime = task?.created_at || 0;
    const relatedDecisions = decisions.filter((d: any) => {
      const timeDiff = Math.abs(d.created_at - taskTime);
      return timeDiff < 3600; // Within 1 hour
    });

    // Suggest next steps based on state machine
    const suggestedNextSteps = this.suggestNextSteps(project?.state, task, milestones);

    return {
      project,
      task,
      relatedDecisions,
      allDecisions: decisions,
      milestones,
      suggestedNextSteps,
    };
  }

  private buildIssueBody(data: any): string {
    const { project, task, relatedDecisions, allDecisions, suggestedNextSteps } = data;

    let body = `## HEOP Auto-Generated Issue\n\n`;
    body += `**Project:** ${project?.name || 'Unknown'} (${project?.id})\n`;
    body += `**State:** ${project?.state || 'Unknown'}\n`;
    body += `**Task:** #${task?.id || 'Unknown'}\n\n`;

    if (task?.error_log) {
      body += `### Error Log\n\n\`\`\`\n${task.error_log}\n\`\`\`\n\n`;
    }

    if (relatedDecisions.length > 0) {
      body += `### Related Decisions\n\n`;
      for (const decision of relatedDecisions) {
        body += `- **${decision.context}**: ${decision.choice}\n`;
        body += `  - Rationale: ${decision.rationale}\n`;
        body += `  - Confidence: ${(decision.confidence * 100).toFixed(1)}%\n`;
        body += `  - Source: ${decision.source_agent}\n\n`;
      }
    }

    if (allDecisions.length > 0) {
      const outdated = allDecisions.filter(
        (d: any) => !relatedDecisions.find((rd: any) => rd.id === d.id)
      );
      if (outdated.length > 0) {
        body += `### Potentially Outdated Decisions\n\n`;
        for (const decision of outdated.slice(0, 3)) {
          body += `- ${decision.context}: ${decision.choice} (${decision.rationale})\n`;
        }
        body += `\n`;
      }
    }

    if (suggestedNextSteps.length > 0) {
      body += `### Suggested Next Steps\n\n`;
      for (const step of suggestedNextSteps) {
        body += `- [ ] ${step}\n`;
      }
    }

    body += `\n---\n*Generated by HEOP (Hermes Engineering OS Plugin)*`;

    return body;
  }

  private suggestNextSteps(
    currentState: string,
    task: any,
    milestones: any[]
  ): string[] {
    const steps: string[] = [];

    switch (currentState) {
      case 'CREATED':
        steps.push('Review PRD and ensure all requirements are captured');
        steps.push('Run deepcode_bootstrap to generate initial skeleton');
        break;
      case 'PLANNED':
        steps.push('Verify build succeeds: `npm run build` or `cargo build`');
        steps.push('Run Docker health check: `docker-compose up -d`');
        break;
      case 'BOOTSTRAPPED':
        steps.push('Pick next requirement from backlog');
        steps.push('Run claude_code_execute for incremental development');
        break;
      case 'INCREMENTAL_DEV':
        steps.push('Run tests: `npm test` or `cargo test`');
        steps.push('Check test coverage meets threshold');
        break;
      case 'TESTING':
        const unachieved = milestones.filter((m: any) => !m.achieved_at);
        for (const ms of unachieved) {
          steps.push(`Achieve milestone: ${ms.name}`);
        }
        break;
      default:
        steps.push('Review task error log');
        steps.push('Check related decisions for outdated assumptions');
    }

    if (task?.error_log) {
      steps.unshift('Fix reported error in task execution');
    }

    return steps;
  }

  private async createIssue(
    title: string,
    body: string,
    labels: string[]
  ): Promise<{ url?: string; number?: number }> {
    // In production, this would call GitHub/GitLab API
    console.log(`[Issue Auto] Would create issue on ${this.config.issueProvider}:`);
    console.log(`  Title: ${title}`);
    console.log(`  Labels: ${labels.join(', ')}`);

    return {
      url: `https://github.com/simulated/repo/issues/${Date.now()}`,
      number: Date.now(),
    };
  }
}

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
export declare class IssueAutomation {
    private store?;
    private config;
    constructor(storeOrConfig: SSOTStore | HEOPConfig, config?: HEOPConfig);
    createStructuredIssue(args: StructuredIssueInput): Promise<any>;
    private assembleIssueData;
    private buildIssueBody;
    private suggestNextSteps;
    private createIssue;
}
//# sourceMappingURL=issue.d.ts.map
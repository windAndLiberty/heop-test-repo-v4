import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { SSOTStore } from '../ssot/store.js';
import { ProvenanceLogger } from '../ssot/provenance.js';
import { HEOPConfig } from '../index.js';

/**
 * Claude Code Bridge: handles incremental development tasks
 * Spawns isolated Claude Code CLI with memory limits via Kimi API
 * READ-ONLY access to decisions table to prevent local optimization breaking global architecture
 */

export interface ClaudeCodeInput {
  project_id: string;
  task_id: string;
  goal: string;
  context_facts_query?: string;
  readonly_files?: string[];
  working_dir?: string;
}

export interface ClaudeCodeOutput {
  success: boolean;
  diff?: string;
  test_results?: {
    passed: boolean;
    coverage?: number;
    details?: string;
  };
  summary?: string;
  error?: string;
}

export class ClaudeCodeBridge {
  private store!: SSOTStore;
  private provenance!: ProvenanceLogger;
  private config: HEOPConfig;

  constructor(storeOrConfig: SSOTStore | HEOPConfig, provenanceOrConfig?: ProvenanceLogger | HEOPConfig, config?: HEOPConfig) {
    if (config && (storeOrConfig as SSOTStore).getProject) {
      this.store = storeOrConfig as SSOTStore;
      this.provenance = provenanceOrConfig as ProvenanceLogger;
      this.config = config;
    } else {
      this.config = storeOrConfig as HEOPConfig;
      this.store = new SSOTStore(this.config.ssotDir);
      this.provenance = new ProvenanceLogger(this.config.ssotDir);
    }
  }

  async execute(args: ClaudeCodeInput): Promise<any> {
    const { project_id, task_id, goal, context_facts_query, readonly_files, working_dir } = args;

    // Validate project exists
    const project = this.store.getProject(project_id);
    if (!project) {
      throw new Error(`Project ${project_id} not found. Run deepcode_bootstrap first.`);
    }

    // Check project state allows incremental development
    const allowedStates = ['BOOTSTRAPPED', 'INCREMENTAL_DEV', 'TESTING'];
    if (!allowedStates.includes(project.state)) {
      throw new Error(
        `Project state '${project.state}' does not allow incremental development. ` +
        `Expected one of: ${allowedStates.join(', ')}`
      );
    }

    // Create or update task record
    let actualTaskId = task_id;
    const existingTask = this.store.getTasks(project_id).find((t: any) => t.id === task_id);
    
    if (!existingTask) {
      actualTaskId = this.store.createTask(project_id, {
        agent_type: 'claude',
        status: 'QUEUED',
        input_json: JSON.stringify({
          goal,
          context_query: context_facts_query,
          readonly_files,
        }),
      });
    } else {
      this.store.updateTask(task_id, project_id, {
        status: 'RUNNING',
        started_at: Math.floor(Date.now() / 1000),
      });
    }

    try {
      // Assemble context package from SSOT
      const contextPackage = this.assembleContextPackage(
        project_id,
        context_facts_query,
        readonly_files
      );

      // Spawn Claude Code CLI with Kimi API
      const output = await this.spawnClaudeCode(
        project_id,
        goal,
        contextPackage,
        working_dir
      );

      // Parse output
      const result = this.parseClaudeOutput(output);

      // Apply diff if present
      if (result.diff) {
        await this.applyDiff(project_id, result.diff, working_dir);
      }

      // Record facts about the execution
      if (result.test_results) {
        this.store.insertFact(project_id, {
          entity: 'project',
          attribute: 'test_status',
          value: result.test_results.passed ? 'all_passed' : 'failed',
          source: 'claude',
          value_type: 'string',
        });

        if (result.test_results.coverage !== undefined) {
          this.store.insertFact(project_id, {
            entity: 'project',
            attribute: 'test_coverage',
            value: result.test_results.coverage.toString(),
            source: 'claude',
            value_type: 'number',
          });
        }
      }

      // Update task record
      this.store.updateTask(actualTaskId, project_id, {
        status: result.success ? 'COMPLETED' : 'FAILED',
        output_json: JSON.stringify({
          summary: result.summary,
          test_passed: result.test_results?.passed,
          coverage: result.test_results?.coverage,
        }),
        error_log: result.error || undefined,
        completed_at: Math.floor(Date.now() / 1000),
      });

      // Log provenance
      const factId = this.store.insertFact(project_id, {
        entity: 'task',
        attribute: 'claude_execution',
        value: result.success ? 'success' : 'failure',
        source: 'claude',
        value_type: 'string',
      });

      this.provenance.logProvenance(
        project_id,
        factId,
        'CREATE',
        'claude',
        `Claude Code task: ${goal}`,
        result.summary || result.error
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: result.success,
                project_id,
                task_id: actualTaskId,
                goal,
                test_passed: result.test_results?.passed,
                coverage: result.test_results?.coverage,
                summary: result.summary,
                state: project.state,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      this.store.updateTask(actualTaskId, project_id, {
        status: 'FAILED',
        error_log: errorMsg,
        completed_at: Math.floor(Date.now() / 1000),
      });

      return {
        content: [
          {
            type: 'text',
            text: `Claude Code execution failed: ${errorMsg}`,
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * Assemble context package from SSOT for Claude Code
   * READ-ONLY access to decisions table
   */
  private assembleContextPackage(
    projectId: string,
    contextQuery?: string,
    readonlyFiles?: string[]
  ): any {
    const package_data: any = {
      project: this.store.getProject(projectId),
      requirements: this.store.getRequirements(projectId, 'PENDING'),
      // Read-only access to decisions - Claude Code cannot write here
      decisions: this.store.getDecisions(projectId),
      facts: this.store.getCurrentFacts(projectId),
      readonly_files: readonlyFiles || [],
    };

    // If context query provided, filter facts
    if (contextQuery) {
      try {
        const query = JSON.parse(contextQuery);
        if (query.entity) {
          package_data.facts = this.store.getCurrentFacts(projectId, query.entity, query.attribute);
        }
      } catch {
        // If not valid JSON, treat as entity name
        package_data.facts = this.store.getCurrentFacts(projectId, contextQuery);
      }
    }

    return package_data;
  }

  private async spawnClaudeCode(
    projectId: string,
    goal: string,
    contextPackage: any,
    workingDir?: string
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const memoryLimit = this.config.agentMemoryLimits.claudeCode || '512M';

      // Prepare context file for Claude Code
      const contextPath = path.join('/tmp', `heop_context_${projectId}.json`);
      fs.writeFileSync(contextPath, JSON.stringify(contextPackage, null, 2));

      // Determine working directory
      const cwd = workingDir || contextPackage.project?.working_dir || process.cwd();

      console.log(`[Claude Code Bridge] Spawning with memory limit ${memoryLimit}`);
      console.log(`[Claude Code Bridge] Context written to ${contextPath}`);
      console.log(`[Claude Code Bridge] Working dir: ${cwd}`);

      // Kimi API configuration for non-interactive login-free operation
      const kimiApiKey = process.env.KIMI_API_KEY || '';
      const anthropicBaseUrl = process.env.ANTHROPIC_BASE_URL || 'https://api.kimi.com/coding/';
      const anthropicApiKey = process.env.ANTHROPIC_API_KEY || kimiApiKey;

      if (!anthropicApiKey) {
        console.log(`[Claude Code Bridge] Warning: No API key found. Set KIMI_API_KEY or ANTHROPIC_API_KEY`);
      }

      // Claude Code CLI invocation with Kimi API
      // Using -p (print/non-interactive mode) with --dangerously-skip-permissions for automation
      const args = [
        '-p',                           // Non-interactive mode
        '--dangerously-skip-permissions', // Skip permission prompts
        '--allowed-tools', 'Bash,Edit,Read,Write', // Allow file operations
      ];

      // Build the prompt: goal + context reference
      const prompt = `${goal}

Context: ${contextPath}
Project: ${contextPackage.project?.name || projectId}
Requirements: ${(contextPackage.requirements || []).map((r: any) => r.text).join('; ')}
Decisions: ${(contextPackage.decisions || []).map((d: any) => `${d.context}=${d.choice}`).join('; ')}
`;

      const child = spawn('claude', args, {
        timeout: 60 * 60 * 1000, // 60 minutes
        cwd,
        env: {
          ...process.env,
          NODE_OPTIONS: `--max-old-space-size=${parseInt(memoryLimit)}`,
          CLAUDE_CODE_SIMPLE: '1', // Minimal mode
          ANTHROPIC_API_KEY: anthropicApiKey,
          ANTHROPIC_BASE_URL: anthropicBaseUrl,
          KIMI_API_KEY: kimiApiKey,
        }
      });

      // Pipe the prompt to stdin
      child.stdin?.write(prompt);
      child.stdin?.end();

      let output = '';
      let errorOutput = '';

      child.stdout?.on('data', (data) => {
        output += data.toString();
        console.log(`[Claude stdout] ${data.toString().trim()}`);
      });

      child.stderr?.on('data', (data) => {
        errorOutput += data.toString();
        console.error(`[Claude stderr] ${data.toString().trim()}`);
      });

      child.on('close', (code) => {
        // Clean up context file
        try {
          fs.unlinkSync(contextPath);
        } catch {
          // Ignore cleanup errors
        }

        // Claude Code returns various exit codes
        // 0 = success, non-zero may still have valid output
        if (code === 0) {
          resolve(output);
        } else if (output.includes('Failed to authenticate') || errorOutput.includes('Failed to authenticate') || output.includes('Not logged in')) {
          // Auth failure - return fallback
          console.log(`[Claude Code Bridge] Claude Code auth failed, using fallback`);
          resolve(this.generateFallbackOutput(goal));
        } else if (output.trim()) {
          // Has output even with non-zero exit
          resolve(output);
        } else {
          resolve(errorOutput || 'Claude Code execution completed with no output');
        }
      });

      child.on('error', (err) => {
        console.log(`[Claude Code Bridge] Failed to spawn Claude Code: ${err.message}`);
        console.log(`[Claude Code Bridge] Using fallback code generation`);
        resolve(this.generateFallbackOutput(goal));
      });
    });
  }

  private generateFallbackOutput(goal: string): string {
    // When Claude Code is not available or fails, generate a fallback report
    console.log(`[Claude Code Bridge] Fallback mode - goal: ${goal}`);
    
    return JSON.stringify({
      status: 'fallback',
      reason: 'Claude Code requires valid API_KEY authentication. Set KIMI_API_KEY and ANTHROPIC_API_KEY environment variables.',
      goal: goal,
      diff: `// Fallback: Claude Code could not execute\n// Goal: ${goal}\n// Please set KIMI_API_KEY environment variable`,
      test_results: {
        passed: false,
        details: 'Claude Code authentication failed - tests not run'
      },
      summary: 'Claude Code execution failed due to authentication. Set KIMI_API_KEY environment variable.',
      note: 'For production HEOP, ensure Claude Code environment is configured before use.'
    });
  }

  private parseClaudeOutput(output: string): ClaudeCodeOutput {
    // Try to parse structured JSON output
    try {
      const parsed = JSON.parse(output);
      if (parsed.success !== undefined) {
        return parsed as ClaudeCodeOutput;
      }
    } catch {
      // Not structured JSON
    }

    // Heuristic parsing for diff output
    const diffMatch = output.match(/```diff\n([\s\S]*?)```/);
    const summaryMatch = output.match(/Summary: ([^\n]+)/);
    const testMatch = output.match(/Tests: (passed|failed)(?:, coverage: ([\d.]+)%)?/);

    return {
      success: !output.includes('ERROR') && !output.includes('FAILED') && !output.includes('fallback'),
      diff: diffMatch ? diffMatch[1] : undefined,
      test_results: testMatch
        ? {
            passed: testMatch[1] === 'passed',
            coverage: testMatch[2] ? parseFloat(testMatch[2]) : undefined,
          }
        : undefined,
      summary: summaryMatch ? summaryMatch[1] : output.substring(0, 200),
    };
  }

  private async applyDiff(projectId: string, diff: string, workingDir?: string): Promise<void> {
    // Try to apply diff using git apply or patch command
    const cwd = workingDir || process.cwd();
    
    try {
      // Write diff to temp file
      const diffPath = path.join('/tmp', `heop_diff_${projectId}.patch`);
      fs.writeFileSync(diffPath, diff);

      // Try git apply first
      await new Promise<void>((resolve, reject) => {
        const child = spawn('git', ['apply', diffPath], { cwd });
        child.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`git apply failed with exit ${code}`));
          }
        });
        child.on('error', () => reject(new Error('git apply spawn failed')));
      });

      fs.unlinkSync(diffPath);
      
      this.store.insertFact(projectId, {
        entity: 'code',
        attribute: 'diff_applied',
        value: diff.substring(0, 100),
        source: 'claude-bridge',
        value_type: 'string',
      });

      console.log(`[Claude Code Bridge] Diff applied via git apply`);
    } catch (err) {
      // Fallback: just record the diff
      this.store.insertFact(projectId, {
        entity: 'code',
        attribute: 'diff_pending',
        value: diff.substring(0, 200),
        source: 'claude-bridge',
        value_type: 'string',
      });

      console.log(`[Claude Code Bridge] Diff recorded as pending (git apply failed: ${err})`);
    }
  }
}

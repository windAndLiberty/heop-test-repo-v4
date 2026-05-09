import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { SSOTStore } from '../ssot/store.js';
import { ProvenanceLogger } from '../ssot/provenance.js';
import { HEOPConfig } from '../index.js';

/**
 * Kimi Bridge: 直接调用 Kimi API (OpenAI-compatible) 进行代码生成和增量开发
 * 不依赖 Claude Code CLI，直接通过 HTTP API 调用 Kimi 模型
 * 用于轻量级任务、快速代码生成、以及作为 Claude Code Bridge 的替代方案
 */

export interface KimiInput {
  project_id: string;
  task_id?: string;
  goal: string;
  context_facts_query?: string;
  readonly_files?: string[];
  working_dir?: string;
  model?: string; // 默认 'kimi-k2-0711-preview'
  temperature?: number;
  max_tokens?: number;
}

export interface KimiOutput {
  success: boolean;
  generated_files?: Array<{
    path: string;
    content: string;
  }>;
  diff?: string;
  summary?: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  error?: string;
}

export class KimiBridge {
  private store!: SSOTStore;
  private provenance!: ProvenanceLogger;
  private config: HEOPConfig;
  private apiKey: string;
  private baseUrl: string;

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

    // Kimi API configuration
    // Supports both direct Kimi API and Kimi-through-Anthropic-proxy (Claude Code CLI mode)
    this.apiKey = process.env.KIMI_API_KEY || process.env.ANTHROPIC_API_KEY || '';
    this.baseUrl = process.env.KIMI_BASE_URL || process.env.ANTHROPIC_BASE_URL || 'https://api.moonshot.cn/v1';
  }

  async execute(args: KimiInput): Promise<any> {
    const { project_id, task_id, goal, context_facts_query, readonly_files, working_dir, model, temperature, max_tokens } = args;

    // Validate project exists
    const project = this.store.getProject(project_id);
    if (!project) {
      throw new Error(`Project ${project_id} not found. Run init_project first.`);
    }

    // Create task record
    let actualTaskId = task_id || `kimi_${Date.now()}`;
    const existingTask = this.store.getTasks(project_id).find((t: any) => t.id === actualTaskId);

    if (!existingTask) {
      actualTaskId = this.store.createTask(project_id, {
        agent_type: 'kimi',
        status: 'QUEUED',
        input_json: JSON.stringify({
          goal,
          context_query: context_facts_query,
          readonly_files,
          model: model || 'kimi-k2-0711-preview',
        }),
      });
    } else {
      this.store.updateTask(actualTaskId, project_id, {
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

      // Call Kimi API directly
      const result = await this.callKimiAPI({
        goal,
        contextPackage,
        working_dir,
        model: model || 'kimi-k2-0711-preview',
        temperature: temperature || 0.3,
        max_tokens: max_tokens || 8192,
      });

      // Apply generated files to working directory
      if (result.generated_files && working_dir) {
        for (const file of result.generated_files) {
          const filePath = path.join(working_dir, file.path);
          fs.mkdirSync(path.dirname(filePath), { recursive: true });
          fs.writeFileSync(filePath, file.content);
        }
      }

      // Record generated code state
      this.store.insertFact(project_id, {
        entity: 'project',
        attribute: 'code_generated_by_kimi',
        value: JSON.stringify(result.generated_files?.map(f => f.path) || []),
        source: 'kimi',
        value_type: 'json',
      });

      // Update task
      this.store.updateTask(actualTaskId, project_id, {
        status: 'COMPLETED',
        output_json: JSON.stringify({
          summary: result.summary,
          files_generated: result.generated_files?.length || 0,
          usage: result.usage,
        }),
        completed_at: Math.floor(Date.now() / 1000),
      });

      // Log provenance
      this.provenance.logProvenance(
        project_id,
        actualTaskId,
        'CREATE',
        'kimi',
        `Kimi API call: ${goal.substring(0, 100)}`,
        result.summary || 'Code generation completed'
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              project_id,
              task_id: actualTaskId,
              files_generated: result.generated_files?.length || 0,
              summary: result.summary,
              usage: result.usage,
            }, null, 2),
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
            text: `Kimi API call failed: ${errorMsg}`,
          },
        ],
        isError: true,
      };
    }
  }

  private assembleContextPackage(
    projectId: string,
    contextQuery?: string,
    readonlyFiles?: string[]
  ): string {
    const parts: string[] = [];

    // Add project decisions (READ-ONLY for Kimi, same as Claude)
    const decisions = this.store.getDecisions(projectId);
    if (decisions.length > 0) {
      parts.push('## Architecture Decisions (READ-ONLY)');
      for (const decision of decisions.slice(0, 5)) {
        parts.push(`- ${decision.context}: ${decision.choice} (confidence: ${decision.confidence})`);
        parts.push(`  Rationale: ${decision.rationale}`);
      }
    }

    // Add relevant facts
    const facts = this.store.getCurrentFacts(projectId);
    const relevantFacts = contextQuery
      ? facts.filter((f: any) =>
          f.entity.includes(contextQuery) || f.attribute.includes(contextQuery)
        )
      : facts.slice(0, 10);

    if (relevantFacts.length > 0) {
      parts.push('## Current Facts');
      for (const fact of relevantFacts) {
        parts.push(`- ${fact.entity}.${fact.attribute}: ${String(fact.value).substring(0, 100)}`);
      }
    }

    // Add readonly file contents
    if (readonlyFiles) {
      parts.push('## Read-Only Reference Files');
      for (const filePath of readonlyFiles) {
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, 'utf-8');
          parts.push(`### ${path.basename(filePath)}`);
          parts.push('```');
          parts.push(content.substring(0, 2000)); // Limit file content
          parts.push('```');
        }
      }
    }

    return parts.join('\n');
  }

  private async callKimiAPI(args: {
    goal: string;
    contextPackage: string;
    working_dir?: string;
    model: string;
    temperature: number;
    max_tokens: number;
  }): Promise<KimiOutput> {
    const { goal, contextPackage, working_dir, model, temperature, max_tokens } = args;

    // Build system prompt
    const systemPrompt = `You are a software engineering agent. Your task is to generate or modify code based on the provided context.
Rules:
1. Output files in the format: === FILE: path/to/file ===\n followed by file content
2. Only modify/create files relevant to the task
3. Respect existing architecture decisions (marked READ-ONLY)
4. End with a summary of changes`;

    // Build user prompt
    const userPrompt = `## Task\n${goal}\n\n${contextPackage}\n\n## Working Directory\n${working_dir || 'Not specified'}\n\nGenerate the required code now.`;

    // Call Kimi API via curl (OpenAI-compatible format)
    const requestBody = JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature,
      max_tokens,
    });

    return new Promise((resolve, reject) => {
      const curlArgs = [
        '-s',
        '-X', 'POST',
        '-H', 'Content-Type: application/json',
        '-H', `Authorization: Bearer ${this.apiKey}`,
        '-d', requestBody,
        `${this.baseUrl}/chat/completions`,
      ];

      const child = spawn('curl', curlArgs);

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Kimi API curl failed (exit ${code}): ${stderr}`));
          return;
        }

        try {
          const response = JSON.parse(stdout);
          if (response.error) {
            reject(new Error(`Kimi API error: ${response.error.message}`));
            return;
          }

          const content = response.choices?.[0]?.message?.content || '';
          const usage = response.usage;

          // Parse generated files from content
          const generatedFiles = this.parseGeneratedFiles(content);
          const summary = this.extractSummary(content);

          resolve({
            success: true,
            generated_files: generatedFiles,
            summary,
            usage: usage ? {
              prompt_tokens: usage.prompt_tokens,
              completion_tokens: usage.completion_tokens,
              total_tokens: usage.total_tokens,
            } : undefined,
          });
        } catch (parseError) {
          reject(new Error(`Failed to parse Kimi API response: ${parseError}`));
        }
      });

      child.on('error', (err) => {
        reject(new Error(`Kimi API spawn error: ${err.message}`));
      });
    });
  }

  private parseGeneratedFiles(content: string): Array<{ path: string; content: string }> {
    const files: Array<{ path: string; content: string }> = [];
    const regex = /===\s*FILE:\s*(.+?)\s*===\n([\s\S]*?)(?====\s*FILE:|\n##\s*Summary|$)/g;
    let match;

    while ((match = regex.exec(content)) !== null) {
      files.push({
        path: match[1].trim(),
        content: match[2].trim(),
      });
    }

    return files;
  }

  private extractSummary(content: string): string {
    const summaryMatch = content.match(/##\s*Summary\n([\s\S]*?)$/);
    if (summaryMatch) {
      return summaryMatch[1].trim();
    }

    // Fallback: return last 500 chars as summary
    return content.slice(-500).trim();
  }

  /**
   * Quick code generation without full context assembly
   * Useful for simple tasks like "generate a README" or "create a config file"
   */
  async quickGenerate(args: {
    prompt: string;
    working_dir?: string;
    model?: string;
    output_file?: string;
  }): Promise<string> {
    const { prompt, working_dir, model, output_file } = args;

    const requestBody = JSON.stringify({
      model: model || 'kimi-k2-0711-preview',
      messages: [
        { role: 'system', content: 'You are a code generation assistant. Output only code, no explanations.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
      max_tokens: 4096,
    });

    return new Promise((resolve, reject) => {
      const curlArgs = [
        '-s',
        '-X', 'POST',
        '-H', 'Content-Type: application/json',
        '-H', `Authorization: Bearer ${this.apiKey}`,
        '-d', requestBody,
        `${this.baseUrl}/chat/completions`,
      ];

      const child = spawn('curl', curlArgs);

      let stdout = '';
      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error('Kimi quick generate failed'));
          return;
        }

        try {
          const response = JSON.parse(stdout);
          const content = response.choices?.[0]?.message?.content || '';

          // Write to file if specified
          if (output_file && working_dir) {
            const filePath = path.join(working_dir, output_file);
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, content);
          }

          resolve(content);
        } catch {
          reject(new Error('Failed to parse Kimi response'));
        }
      });

      child.on('error', reject);
    });
  }
}

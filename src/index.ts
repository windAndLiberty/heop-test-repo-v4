/**
 * HEOP - Hermes Engineering OS Plugin
 * Main entry point: registers MCP Tools, initializes SSOT, hooks into Hermes lifecycle
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';

import { SSOTStore } from './ssot/store.js';
import { SchemaManager } from './ssot/schema.js';
import { ProvenanceLogger } from './ssot/provenance.js';
import { LifecycleEngine } from './lifecycle/fsm.js';
import { TransitionRules } from './lifecycle/transitions.js';
import { DeepCodeBridge } from './bridges/deepcode.js';
import { ClaudeCodeBridge } from './bridges/claude-code.js';
import { KimiBridge } from './bridges/kimi.js';
import { GitAutomation } from './automation/git.js';
import { IssueAutomation } from './automation/issue.js';
import * as path from 'path';

export interface HEOPConfig {
  ssotDir: string;
  gitAutoCommit: boolean;
  issueProvider: 'github' | 'gitlab';
  maxConcurrentAgents: number;
  agentMemoryLimits: {
    deepcode: string;
    claudeCode: string;
  };
}

export class HEOPPlugin {
  private server: Server;
  private store: SSOTStore;
  private schema: SchemaManager;
  private provenance: ProvenanceLogger;
  private lifecycle: LifecycleEngine;
  private deepcodeBridge: DeepCodeBridge;
  private claudeCodeBridge: ClaudeCodeBridge;
  private kimiBridge: KimiBridge;
  private gitAuto: GitAutomation;
  private issueAuto: IssueAutomation;
  private config: HEOPConfig;

  constructor(config: HEOPConfig) {
    this.config = config;
    
    // Initialize core components
    this.schema = new SchemaManager(config.ssotDir);
    this.store = new SSOTStore(this.schema);
    this.provenance = new ProvenanceLogger(this.schema);
    this.lifecycle = new LifecycleEngine(this.store, this.provenance);
    this.deepcodeBridge = new DeepCodeBridge(this.store, this.provenance, config);
    this.claudeCodeBridge = new ClaudeCodeBridge(this.store, this.provenance, config);
    this.kimiBridge = new KimiBridge(this.store, this.provenance, config);
    this.gitAuto = new GitAutomation(this.store, config);
    this.issueAuto = new IssueAutomation(this.store, config);

    // Setup MCP Server
    this.server = new Server(
      {
        name: 'hermes-engineering-os',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.registerTools();
    this.registerLifecycleHooks();
  }

  private registerTools(): void {
    const tools: Tool[] = [
      {
        name: 'deepcode_bootstrap',
        description: '从 PRD/UML 生成项目骨架，仅用于空项目初始化。限制内存1G，超时30分钟。',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: { type: 'string', description: '项目唯一标识' },
            requirements_dir: { type: 'string', description: '包含 PRD.md 的目录路径' },
            constraints_json: { 
              type: 'string', 
              description: "技术约束JSON，如 {'lang':'python','framework':'fastapi'}" 
            },
          },
          required: ['project_id', 'requirements_dir'],
        },
      },
      {
        name: 'claude_code_execute',
        description: '委派 Claude Code 执行增量开发或调试任务。限制内存512M，超时60分钟。',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: { type: 'string', description: '项目唯一标识' },
            task_id: { type: 'string', description: '任务唯一标识' },
            goal: { type: 'string', description: '自然语言任务描述，如"实现 OAuth2 登录"' },
            context_facts_query: { 
              type: 'string', 
              description: 'SSOT查询语句，提取相关事实作为上下文' 
            },
            readonly_files: { 
              type: 'array', 
              items: { type: 'string' },
              description: '只读文件列表' 
            },
          },
          required: ['project_id', 'task_id', 'goal'],
        },
      },
      {
        name: 'kimi_execute',
        description: '直接调用 Kimi API 进行代码生成或增量开发。不依赖 Claude Code CLI，轻量快速。',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: { type: 'string', description: '项目唯一标识' },
            task_id: { type: 'string', description: '任务唯一标识（可选）' },
            goal: { type: 'string', description: '自然语言任务描述' },
            context_facts_query: { 
              type: 'string', 
              description: 'SSOT查询语句，提取相关事实作为上下文' 
            },
            readonly_files: { 
              type: 'array', 
              items: { type: 'string' },
              description: '只读文件列表' 
            },
            model: { 
              type: 'string', 
              default: 'kimi-k2-0711-preview',
              description: 'Kimi 模型名称' 
            },
            temperature: { 
              type: 'number', 
              default: 0.3,
              description: '采样温度' 
            },
            max_tokens: { 
              type: 'number', 
              default: 8192,
              description: '最大生成 token 数' 
            },
          },
          required: ['project_id', 'goal'],
        },
      },
      {
        name: 'ssot_query',
        description: '查询单一事实来源数据库，获取项目状态、需求、决策、事实等',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: { type: 'string', description: '项目唯一标识' },
            table: { 
              type: 'string', 
              enum: ['projects', 'requirements', 'decisions', 'facts', 'tasks', 'milestones'],
              description: '查询的表名' 
            },
            filters: { 
              type: 'object', 
              description: '过滤条件，如 {"status":"PENDING"}' 
            },
            limit: { type: 'number', default: 50 },
          },
          required: ['project_id', 'table'],
        },
      },
      {
        name: 'git_milestone_commit',
        description: '自动读取SSOT变更，生成Conventional Commits格式提交并打Tag。支持创建远程仓库和推送。',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: { type: 'string', description: '项目唯一标识' },
            message_prefix: { type: 'string', description: '提交消息前缀，如 feat(auth)' },
            milestone_name: { type: 'string', description: '里程碑名称' },
            push_remote: { type: 'boolean', default: false, description: '是否推送到远程仓库' },
            create_remote: { type: 'boolean', default: false, description: '是否创建远程GitHub仓库' },
            remote_name: { type: 'string', description: '远程仓库名称（默认使用目录名）' },
            repo_visibility: { type: 'string', enum: ['public', 'private'], default: 'public', description: '仓库可见性' },
          },
          required: ['project_id', 'message_prefix'],
        },
      },
      {
        name: 'github_create_remote_repo',
        description: '使用gh CLI创建远程GitHub仓库',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: { type: 'string', description: '项目唯一标识' },
            repo_name: { type: 'string', description: '仓库名称' },
            visibility: { type: 'string', enum: ['public', 'private'], default: 'public', description: '仓库可见性' },
            description: { type: 'string', description: '仓库描述' },
            push_after_create: { type: 'boolean', default: false, description: '创建后立即推送' },
          },
          required: ['project_id', 'repo_name'],
        },
      },
      {
        name: 'adopt_project',
        description: '将现有项目纳入 HEOP 管理，扫描代码库并推断架构决策，跳过冷启动直接进入增量开发',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: { type: 'string', description: '项目唯一标识' },
            name: { type: 'string', description: '项目名称（默认使用目录名）' },
            working_dir: { type: 'string', description: '项目工作目录绝对路径' },
            description: { type: 'string', description: '项目描述' },
            tech_stack: { type: 'object', description: '可选：手动指定技术栈，如 {"language":"rust","framework":"axum"}' },
          },
          required: ['project_id', 'working_dir'],
        },
      },
      {
        name: 'github_create_structured_issue',
        description: '当任务失败或状态机阻塞时，自动创建结构化Issue',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: { type: 'string', description: '项目唯一标识' },
            title: { type: 'string', description: 'Issue标题' },
            task_id: { type: 'string', description: '关联的失败任务ID' },
            labels: { 
              type: 'array', 
              items: { type: 'string' },
              default: ['heop', 'auto-generated'] 
            },
          },
          required: ['project_id', 'title', 'task_id'],
        },
      },
      {
        name: 'project_status',
        description: '获取项目当前状态、里程碑进度、最近任务摘要',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: { type: 'string', description: '项目唯一标识' },
          },
          required: ['project_id'],
        },
      },
    ];

    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'deepcode_bootstrap':
            return await this.deepcodeBridge.execute(args as any);
          
          case 'claude_code_execute':
            return await this.claudeCodeBridge.execute(args as any);
          
          case 'kimi_execute':
            return await this.kimiBridge.execute(args as any);
          
          case 'ssot_query':
            return await this.handleSSOTQuery(args as any);
          
          case 'git_milestone_commit':
            return await this.gitAuto.milestoneCommit(args as any);
          
          case 'github_create_remote_repo':
            return await this.gitAuto.createRemoteRepo(args as any);
          
          case 'github_create_structured_issue':
            return await this.issueAuto.createStructuredIssue(args as any);
          
          case 'adopt_project':
            return await this.adoptProject(args as any);
          
          case 'project_status':
            return await this.handleProjectStatus(args as any);
          
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  private async handleSSOTQuery(args: {
    project_id: string;
    table: string;
    filters?: Record<string, any>;
    limit?: number;
  }) {
    const results = this.store.query(args.project_id, args.table, args.filters, args.limit || 50);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(results, null, 2),
        },
      ],
    };
  }

  private async handleProjectStatus(args: { project_id: string }) {
    const status = this.store.getProjectStatus(args.project_id);
    const milestones = this.store.getMilestones(args.project_id);
    const recentTasks = this.store.getRecentTasks(args.project_id, 5);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            status,
            milestones,
            recentTasks,
          }, null, 2),
        },
      ],
    };
  }

  private registerLifecycleHooks(): void {
    // Register post-task hook for FSM evaluation
    // This would be called by Hermes core when tasks complete
    (global as any).Hermes?.on?.('task:completed', async (task: any) => {
      await this.lifecycle.evaluateAndTransition(task.project_id, task);
    });
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('HEOP Plugin running on stdio');
  }

  // Direct API for programmatic use (bypass MCP stdio)
  async initProject(args: any): Promise<any> {
    const { project_id, name, description, requirements_dir, working_dir, constraints_json } = args;
    const project = this.store.createProject(project_id, name, description);
    if (requirements_dir) {
      this.store.addRequirement(project_id, 'PRD', `Project requirements from ${requirements_dir}`, 'human', 1);
    }
    if (constraints_json) {
      const constraints = JSON.parse(require('fs').readFileSync(constraints_json, 'utf-8'));
      this.store.insertFact(project_id, {
        entity: 'project',
        attribute: 'constraints',
        value: JSON.stringify(constraints),
        source: 'human',
        value_type: 'json',
      });
    }
    this.lifecycle.initProject(project_id);
    return {
      content: [{ type: 'text', text: JSON.stringify({ success: true, project_id, state: 'CREATED' }) }],
    };
  }

  /**
   * Adopt an existing project into HEOP SSOT
   * Scans codebase, extracts decisions from code/comments, records initial state
   * Skips cold-start (CREATED -> PLANNED -> BOOTSTRAPPED), enters ADOPTED state
   */
  async adoptProject(args: any): Promise<any> {
    const { project_id, name, working_dir, description, tech_stack } = args;

    const fs = require('fs');
    if (!working_dir || !fs.existsSync(working_dir)) {
      throw new Error(`Working directory ${working_dir} does not exist`);
    }

    // 1. Create project in SSOT with ADOPTED state
    this.store.createProject(project_id, name || path.basename(working_dir), description);
    this.store.updateProjectState(project_id, 'ADOPTED');

    // 2. Record adoption fact
    this.store.insertFact(project_id, {
      entity: 'project',
      attribute: 'adopted_from',
      value: working_dir,
      source: 'human',
      value_type: 'string',
    });

    // 3. Scan codebase structure
    const structure = this.scanCodebase(working_dir);
    this.store.insertFact(project_id, {
      entity: 'project',
      attribute: 'codebase_scanned',
      value: JSON.stringify(structure),
      source: 'hermes',
      value_type: 'json',
    });

    // 4. Extract tech stack from package files
    const detectedStack = this.detectTechStack(working_dir);
    const finalStack = tech_stack || detectedStack;
    this.store.insertFact(project_id, {
      entity: 'project',
      attribute: 'tech_stack',
      value: JSON.stringify(finalStack),
      source: 'hermes',
      value_type: 'json',
    });

    // 5. Infer architecture decisions from code
    const inferredDecisions = this.inferDecisions(working_dir, finalStack);
    for (const decision of inferredDecisions) {
      this.store.addDecision(
        project_id,
        decision.context,
        decision.choice,
        decision.rationale,
        decision.confidence || 0.7,
        'hermes-inferred',
      );
    }

    // 6. Record git state if present
    const gitInfo = this.getGitInfo(working_dir);
    if (gitInfo) {
      this.store.insertFact(project_id, {
        entity: 'project',
        attribute: 'git_state',
        value: JSON.stringify(gitInfo),
        source: 'hermes',
        value_type: 'json',
      });
    }

    // 7. Log provenance
    const factId = this.store.insertFact(project_id, {
      entity: 'project',
      attribute: 'state',
      value: 'ADOPTED',
      source: 'hermes-lifecycle',
      value_type: 'string',
    });
    this.provenance.logProvenance(
      project_id,
      factId,
      'CREATE',
      'human',
      `Adopted existing project from ${working_dir}`,
      `Tech stack: ${JSON.stringify(finalStack)}, Inferred decisions: ${inferredDecisions.length}`
    );

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          project_id,
          state: 'ADOPTED',
          working_dir,
          tech_stack: finalStack,
          codebase_files: structure.files.length,
          inferred_decisions: inferredDecisions.length,
          git_commits: gitInfo?.commit_count || 0,
          message: 'Project adopted. Ready for incremental development.',
        }, null, 2),
      }],
    };
  }

  private scanCodebase(workingDir: string): any {
    const fs = require('fs');
    const path = require('path');
    const files: string[] = [];
    const dirs: string[] = [];

    const scan = (dir: string, depth: number = 0) => {
      if (depth > 3) return; // Limit depth
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'target') continue;
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            dirs.push(path.relative(workingDir, fullPath));
            scan(fullPath, depth + 1);
          } else {
            files.push(path.relative(workingDir, fullPath));
          }
        }
      } catch {
        // Ignore permission errors
      }
    };

    scan(workingDir);
    return { files, dirs, root: workingDir, scanned_at: new Date().toISOString() };
  }

  private detectTechStack(workingDir: string): any {
    const fs = require('fs');
    const path = require('path');
    const stack: any = {};

    // Detect from package files
    if (fs.existsSync(path.join(workingDir, 'package.json'))) {
      const pkg = JSON.parse(fs.readFileSync(path.join(workingDir, 'package.json'), 'utf-8'));
      stack.language = 'javascript';
      stack.framework = pkg.dependencies?.next ? 'next' :
                        pkg.dependencies?.react ? 'react' :
                        pkg.dependencies?.express ? 'express' :
                        pkg.dependencies?.fastify ? 'fastify' : 'node';
      stack.package_manager = fs.existsSync(path.join(workingDir, 'pnpm-lock.yaml')) ? 'pnpm' :
                              fs.existsSync(path.join(workingDir, 'yarn.lock')) ? 'yarn' : 'npm';
    }

    if (fs.existsSync(path.join(workingDir, 'Cargo.toml'))) {
      stack.language = 'rust';
      const cargo = fs.readFileSync(path.join(workingDir, 'Cargo.toml'), 'utf-8');
      stack.framework = cargo.includes('axum') ? 'axum' :
                        cargo.includes('actix') ? 'actix-web' :
                        cargo.includes('rocket') ? 'rocket' : 'rust';
    }

    if (fs.existsSync(path.join(workingDir, 'go.mod'))) {
      stack.language = 'go';
    }

    if (fs.existsSync(path.join(workingDir, 'requirements.txt')) || fs.existsSync(path.join(workingDir, 'pyproject.toml'))) {
      stack.language = 'python';
    }

    // Detect database
    if (fs.existsSync(path.join(workingDir, 'prisma'))) stack.database = 'prisma';
    else if (fs.existsSync(path.join(workingDir, 'migrations'))) stack.database = 'sqlx';
    else stack.database = 'unknown';

    return stack;
  }

  private inferDecisions(workingDir: string, techStack: any): any[] {
    const fs = require('fs');
    const path = require('path');
    const decisions: any[] = [];

    // Infer from tech stack
    if (techStack.language) {
      decisions.push({
        context: 'Programming Language',
        choice: techStack.language,
        rationale: `Detected from project files (${techStack.language === 'javascript' ? 'package.json' : techStack.language === 'rust' ? 'Cargo.toml' : 'project files'})`,
        confidence: 0.95,
      });
    }

    if (techStack.framework) {
      decisions.push({
        context: 'Web Framework',
        choice: techStack.framework,
        rationale: `Detected from dependencies`,
        confidence: 0.9,
      });
    }

    // Infer from directory structure
    if (fs.existsSync(path.join(workingDir, 'src', 'routes')) || fs.existsSync(path.join(workingDir, 'app', 'api'))) {
      decisions.push({
        context: 'Architecture Pattern',
        choice: 'route-based',
        rationale: 'Detected routes/ or app/api/ directory structure',
        confidence: 0.8,
      });
    }

    if (fs.existsSync(path.join(workingDir, 'docker-compose.yml')) || fs.existsSync(path.join(workingDir, 'Dockerfile'))) {
      decisions.push({
        context: 'Deployment',
        choice: 'containerized',
        rationale: 'Detected Docker configuration files',
        confidence: 0.85,
      });
    }

    // Infer from config files
    if (fs.existsSync(path.join(workingDir, '.github', 'workflows'))) {
      decisions.push({
        context: 'CI/CD',
        choice: 'github-actions',
        rationale: 'Detected .github/workflows directory',
        confidence: 0.9,
      });
    }

    return decisions;
  }

  private getGitInfo(workingDir: string): any {
    const { spawn } = require('child_process');
    try {
      const commitCount = spawn('git', ['rev-list', '--count', 'HEAD'], { cwd: workingDir, encoding: 'utf-8' });
      const branch = spawn('git', ['branch', '--show-current'], { cwd: workingDir, encoding: 'utf-8' });
      const remote = spawn('git', ['remote', '-v'], { cwd: workingDir, encoding: 'utf-8' });

      // Synchronous read for simplicity
      const { execSync } = require('child_process');
      return {
        commit_count: parseInt(execSync('git rev-list --count HEAD', { cwd: workingDir, encoding: 'utf-8' }).trim()),
        branch: execSync('git branch --show-current', { cwd: workingDir, encoding: 'utf-8' }).trim(),
        has_remote: execSync('git remote', { cwd: workingDir, encoding: 'utf-8' }).trim().length > 0,
        last_commit: execSync('git log -1 --format=%H', { cwd: workingDir, encoding: 'utf-8' }).trim(),
      };
    } catch {
      return null;
    }
  }

  async deepcodeBootstrap(args: any): Promise<any> {
    return this.deepcodeBridge.execute(args);
  }

  async claudeCodeIncremental(args: any): Promise<any> {
    return this.claudeCodeBridge.execute(args);
  }

  async kimiExecute(args: any): Promise<any> {
    return this.kimiBridge.execute(args);
  }

  async gitMilestoneCommit(args: any): Promise<any> {
    return this.gitAuto.milestoneCommit(args);
  }

  async createRemoteRepo(args: any): Promise<any> {
    return this.gitAuto.createRemoteRepo(args);
  }

  async ssotQuery(args: any): Promise<any> {
    return this.handleSSOTQuery(args);
  }

  async projectStatus(args: any): Promise<any> {
    return this.handleProjectStatus(args);
  }
}

// Export for Hermes plugin loader
export default HEOPPlugin;
export { SSOTStore, SchemaManager, ProvenanceLogger, LifecycleEngine };
export { DeepCodeBridge, ClaudeCodeBridge };
export { GitAutomation, IssueAutomation };

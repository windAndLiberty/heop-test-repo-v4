"use strict";
/**
 * HEOP - Hermes Engineering OS Plugin
 * Main entry point: registers MCP Tools, initializes SSOT, hooks into Hermes lifecycle
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.IssueAutomation = exports.GitAutomation = exports.ClaudeCodeBridge = exports.DeepCodeBridge = exports.LifecycleEngine = exports.ProvenanceLogger = exports.SchemaManager = exports.SSOTStore = exports.HEOPPlugin = void 0;
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const store_js_1 = require("./ssot/store.js");
Object.defineProperty(exports, "SSOTStore", { enumerable: true, get: function () { return store_js_1.SSOTStore; } });
const schema_js_1 = require("./ssot/schema.js");
Object.defineProperty(exports, "SchemaManager", { enumerable: true, get: function () { return schema_js_1.SchemaManager; } });
const provenance_js_1 = require("./ssot/provenance.js");
Object.defineProperty(exports, "ProvenanceLogger", { enumerable: true, get: function () { return provenance_js_1.ProvenanceLogger; } });
const fsm_js_1 = require("./lifecycle/fsm.js");
Object.defineProperty(exports, "LifecycleEngine", { enumerable: true, get: function () { return fsm_js_1.LifecycleEngine; } });
const deepcode_js_1 = require("./bridges/deepcode.js");
Object.defineProperty(exports, "DeepCodeBridge", { enumerable: true, get: function () { return deepcode_js_1.DeepCodeBridge; } });
const claude_code_js_1 = require("./bridges/claude-code.js");
Object.defineProperty(exports, "ClaudeCodeBridge", { enumerable: true, get: function () { return claude_code_js_1.ClaudeCodeBridge; } });
const git_js_1 = require("./automation/git.js");
Object.defineProperty(exports, "GitAutomation", { enumerable: true, get: function () { return git_js_1.GitAutomation; } });
const issue_js_1 = require("./automation/issue.js");
Object.defineProperty(exports, "IssueAutomation", { enumerable: true, get: function () { return issue_js_1.IssueAutomation; } });
class HEOPPlugin {
    server;
    store;
    schema;
    provenance;
    lifecycle;
    deepcodeBridge;
    claudeCodeBridge;
    gitAuto;
    issueAuto;
    config;
    constructor(config) {
        this.config = config;
        // Initialize core components
        this.schema = new schema_js_1.SchemaManager(config.ssotDir);
        this.store = new store_js_1.SSOTStore(this.schema);
        this.provenance = new provenance_js_1.ProvenanceLogger(this.schema);
        this.lifecycle = new fsm_js_1.LifecycleEngine(this.store, this.provenance);
        this.deepcodeBridge = new deepcode_js_1.DeepCodeBridge(this.store, this.provenance, config);
        this.claudeCodeBridge = new claude_code_js_1.ClaudeCodeBridge(this.store, this.provenance, config);
        this.gitAuto = new git_js_1.GitAutomation(this.store, config);
        this.issueAuto = new issue_js_1.IssueAutomation(this.store, config);
        // Setup MCP Server
        this.server = new index_js_1.Server({
            name: 'hermes-engineering-os',
            version: '1.0.0',
        }, {
            capabilities: {
                tools: {},
            },
        });
        this.registerTools();
        this.registerLifecycleHooks();
    }
    registerTools() {
        const tools = [
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
        this.server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => {
            return { tools };
        });
        this.server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;
            try {
                switch (name) {
                    case 'deepcode_bootstrap':
                        return await this.deepcodeBridge.execute(args);
                    case 'claude_code_execute':
                        return await this.claudeCodeBridge.execute(args);
                    case 'ssot_query':
                        return await this.handleSSOTQuery(args);
                    case 'git_milestone_commit':
                        return await this.gitAuto.milestoneCommit(args);
                    case 'github_create_remote_repo':
                        return await this.gitAuto.createRemoteRepo(args);
                    case 'github_create_structured_issue':
                        return await this.issueAuto.createStructuredIssue(args);
                    case 'project_status':
                        return await this.handleProjectStatus(args);
                    default:
                        throw new Error(`Unknown tool: ${name}`);
                }
            }
            catch (error) {
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
    async handleSSOTQuery(args) {
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
    async handleProjectStatus(args) {
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
    registerLifecycleHooks() {
        // Register post-task hook for FSM evaluation
        // This would be called by Hermes core when tasks complete
        global.Hermes?.on?.('task:completed', async (task) => {
            await this.lifecycle.evaluateAndTransition(task.project_id, task);
        });
    }
    async start() {
        const transport = new stdio_js_1.StdioServerTransport();
        await this.server.connect(transport);
        console.error('HEOP Plugin running on stdio');
    }
    // Direct API for programmatic use (bypass MCP stdio)
    async initProject(args) {
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
    async deepcodeBootstrap(args) {
        return this.deepcodeBridge.execute(args);
    }
    async claudeCodeIncremental(args) {
        return this.claudeCodeBridge.execute(args);
    }
    async gitMilestoneCommit(args) {
        return this.gitAuto.milestoneCommit(args);
    }
    async createRemoteRepo(args) {
        return this.gitAuto.createRemoteRepo(args);
    }
    async ssotQuery(args) {
        return this.handleSSOTQuery(args);
    }
    async projectStatus(args) {
        return this.handleProjectStatus(args);
    }
}
exports.HEOPPlugin = HEOPPlugin;
// Export for Hermes plugin loader
exports.default = HEOPPlugin;
//# sourceMappingURL=index.js.map
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.KimiBridge = void 0;
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const store_js_1 = require("../ssot/store.js");
const provenance_js_1 = require("../ssot/provenance.js");
class KimiBridge {
    store;
    provenance;
    config;
    constructor(storeOrConfig, provenanceOrConfig, config) {
        if (config && storeOrConfig.getProject) {
            this.store = storeOrConfig;
            this.provenance = provenanceOrConfig;
            this.config = config;
        }
        else {
            this.config = storeOrConfig;
            this.store = new store_js_1.SSOTStore(this.config.ssotDir);
            this.provenance = new provenance_js_1.ProvenanceLogger(this.config.ssotDir);
        }
        // 无需 API key / baseUrl，直接调用本地 kimi CLI
    }
    async execute(args) {
        const { project_id, task_id, goal, context_facts_query, readonly_files, working_dir, model, temperature, max_tokens } = args;
        // Validate project exists
        const project = this.store.getProject(project_id);
        if (!project) {
            throw new Error(`Project ${project_id} not found. Run init_project first.`);
        }
        // Create task record
        let actualTaskId = task_id || `kimi_${Date.now()}`;
        const existingTask = this.store.getTasks(project_id).find((t) => t.id === actualTaskId);
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
        }
        else {
            this.store.updateTask(actualTaskId, project_id, {
                status: 'RUNNING',
                started_at: Math.floor(Date.now() / 1000),
            });
        }
        try {
            // Assemble context package from SSOT
            const contextPackage = this.assembleContextPackage(project_id, context_facts_query, readonly_files);
            // Call kimi CLI directly (user has configured kimi-for-coding as default model)
            const result = await this.callKimiCLI({
                goal,
                contextPackage,
                working_dir,
                model: model || 'kimi-for-coding',
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
            this.provenance.logProvenance(project_id, actualTaskId, 'CREATE', 'kimi', `Kimi API call: ${goal.substring(0, 100)}`, result.summary || 'Code generation completed');
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
        }
        catch (error) {
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
    assembleContextPackage(projectId, contextQuery, readonlyFiles) {
        const parts = [];
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
            ? facts.filter((f) => f.entity.includes(contextQuery) || f.attribute.includes(contextQuery))
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
    async callKimiCLI(args) {
        const { goal, contextPackage, working_dir } = args;
        // Build prompt for kimi CLI
        const prompt = `You are a software engineering agent. Your task is to generate or modify code based on the provided context.
Rules:
1. Output files in the format: === FILE: path/to/file ===\n followed by file content
2. Only modify/create files relevant to the task
3. Respect existing architecture decisions (marked READ-ONLY)
4. End with a summary of changes

## Task
${goal}

${contextPackage}

## Working Directory
${working_dir || 'Not specified'}

Generate the required code now.`;
        return new Promise((resolve, reject) => {
            // 调用本地 kimi CLI，用户已配置默认模型为 kimi-for-coding
            const child = (0, child_process_1.spawn)('kimi', [], {
                cwd: working_dir || process.cwd(),
                env: { ...process.env },
            });
            let stdout = '';
            let stderr = '';
            child.stdout?.on('data', (data) => {
                stdout += data.toString();
            });
            child.stderr?.on('data', (data) => {
                stderr += data.toString();
            });
            // 发送 prompt 到 kimi CLI 的 stdin
            child.stdin?.write(prompt);
            child.stdin?.end();
            child.on('close', (code) => {
                if (code !== 0) {
                    reject(new Error(`kimi CLI failed (exit ${code}): ${stderr}`));
                    return;
                }
                try {
                    const content = stdout;
                    // Parse generated files from content
                    const generatedFiles = this.parseGeneratedFiles(content);
                    const summary = this.extractSummary(content);
                    resolve({
                        success: true,
                        generated_files: generatedFiles,
                        summary,
                        // CLI 模式无 token 用量，标记为 undefined
                        usage: undefined,
                    });
                }
                catch (parseError) {
                    reject(new Error(`Failed to parse kimi CLI response: ${parseError}`));
                }
            });
            child.on('error', (err) => {
                reject(new Error(`kimi CLI spawn error: ${err.message}`));
            });
        });
    }
    parseGeneratedFiles(content) {
        const files = [];
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
    extractSummary(content) {
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
     * Uses local kimi CLI (model already configured by user)
     */
    async quickGenerate(args) {
        const { prompt, working_dir, output_file } = args;
        return new Promise((resolve, reject) => {
            // 调用本地 kimi CLI，用户已配置默认模型
            const child = (0, child_process_1.spawn)('kimi', [], {
                cwd: working_dir || process.cwd(),
                env: { ...process.env },
            });
            let stdout = '';
            child.stdout?.on('data', (data) => {
                stdout += data.toString();
            });
            // 发送 prompt 到 kimi CLI 的 stdin
            child.stdin?.write(prompt);
            child.stdin?.end();
            child.on('close', (code) => {
                if (code !== 0) {
                    reject(new Error('kimi quick generate failed'));
                    return;
                }
                const content = stdout;
                // Write to file if specified
                if (output_file && working_dir) {
                    const filePath = path.join(working_dir, output_file);
                    fs.mkdirSync(path.dirname(filePath), { recursive: true });
                    fs.writeFileSync(filePath, content);
                }
                resolve(content);
            });
            child.on('error', reject);
        });
    }
}
exports.KimiBridge = KimiBridge;
//# sourceMappingURL=kimi.js.map
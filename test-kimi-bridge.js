/**
 * Kimi Bridge 端到端测试
 * 测试目标：
 * 1. 初始化项目 → SSOT
 * 2. Kimi Bridge 直接调用 API 生成代码
 * 3. 验证文件是否写入工作目录
 * 4. 验证 SSOT 记录
 */
const { HEOPPlugin } = require('./dist/index.js');
const fs = require('fs');
const path = require('path');

const TEST_DIR = '/tmp/heop-kimi-test';
const SSOT_DIR = '/tmp/heop-kimi-test-ssot';
const PROJECT_ID = 'test-kimi-integration';

async function runTest() {
  console.log('=== Kimi Bridge Integration Test ===\n');

  // Cleanup
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });
  if (fs.existsSync(SSOT_DIR)) fs.rmSync(SSOT_DIR, { recursive: true });
  fs.mkdirSync(SSOT_DIR, { recursive: true });

  // Initialize HEOP Plugin
  const plugin = new HEOPPlugin({
    ssotDir: SSOT_DIR,
    gitAutoCommit: true,
    issueProvider: 'github',
    maxConcurrentAgents: 1,
    agentMemoryLimits: {
      deepcode: '1G',
      claudeCode: '512M',
    },
  });

  // Step 1: Initialize project
  console.log('Step 1: Initialize project');
  const initRes = await plugin.initProject({
    project_id: PROJECT_ID,
    name: 'Kimi Test Project',
    description: 'Testing Kimi Bridge direct API calls',
  });
  console.log('Init result:', initRes.content[0].text);

  // Step 2: Add a decision for context
  console.log('\nStep 2: Add architecture decision');
  // Note: decisions are added via deepcode bootstrap normally, but we'll add a fact
  plugin.store.insertFact(PROJECT_ID, {
    entity: 'project',
    attribute: 'tech_stack',
    value: 'javascript + express',
    source: 'human',
    value_type: 'string',
  });
  console.log('Fact added');

  // Step 3: Call Kimi Bridge
  console.log('\nStep 3: Call Kimi Bridge to generate code');
  const kimiRes = await plugin.kimiExecute({
    project_id: PROJECT_ID,
    goal: 'Generate a simple Express.js server with a /health endpoint. Output in format: === FILE: src/index.js === followed by code.',
    working_dir: TEST_DIR,
    model: 'kimi-k2-0711-preview',
    temperature: 0.3,
    max_tokens: 2048,
  });
  
  const kimiText = kimiRes.content[0].text;
  console.log('Kimi result:', kimiText.substring(0, 800));

  // Step 4: Check files created
  console.log('\nStep 4: Check created files');
  function listFiles(dir, prefix = '') {
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        console.log(`${prefix}${item}/`);
        listFiles(fullPath, prefix + '  ');
      } else {
        const content = fs.readFileSync(fullPath, 'utf-8');
        console.log(`${prefix}${item} (${content.length} chars)`);
      }
    }
  }
  listFiles(TEST_DIR);

  // Step 5: Verify SSOT
  console.log('\nStep 5: SSOT tasks and facts');
  const tasksRes = await plugin.ssotQuery({
    project_id: PROJECT_ID,
    table: 'tasks',
    filters: {},
  });
  const tasks = JSON.parse(tasksRes.content[0].text);
  console.log(`Found ${tasks.length} tasks`);
  tasks.forEach(t => console.log(`  - ${t.id}: ${t.agent_type} / ${t.status}`));

  const factsRes = await plugin.ssotQuery({
    project_id: PROJECT_ID,
    table: 'facts',
    filters: { source: 'kimi' },
  });
  const facts = JSON.parse(factsRes.content[0].text);
  console.log(`Found ${facts.length} kimi-generated facts`);

  // Summary
  console.log('\n=== Test Complete ===');
  const success = kimiText.includes('success');
  console.log(`Result: ${success ? 'PASS' : 'FAIL'}`);
  
  if (success) {
    const hasFiles = fs.readdirSync(TEST_DIR).length > 0;
    console.log(`Files generated: ${hasFiles ? 'YES' : 'NO'}`);
  }
}

runTest().catch(console.error);

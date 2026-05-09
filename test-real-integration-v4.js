/**
 * 端到端真实集成测试 V4：使用 Direct API（绕过 MCP stdio）
 * 测试目标：
 * 1. 初始化项目 → SSOT
 * 2. DeepCode Bridge (Claude bootstrap) 生成骨架
 * 3. Git 提交 + 创建远程仓库 + 推送
 * 4. 验证远程仓库内容
 */
const { HEOPPlugin } = require('./dist/index.js');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const TEST_DIR = '/tmp/heop-real-test-v4';
const SSOT_DIR = '/tmp/heop-real-test-ssot-v4';
const PROJECT_ID = 'test-real-integration-v4';
const REPO_NAME = 'heop-test-repo-v4';

async function runTest() {
  console.log('=== HEOP Real Integration Test V4 (Direct API) ===\n');

  // Cleanup
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });
  if (fs.existsSync(SSOT_DIR)) fs.rmSync(SSOT_DIR, { recursive: true });
  fs.mkdirSync(SSOT_DIR, { recursive: true });

  // Create PRD
  const prdPath = path.join(TEST_DIR, 'PRD.md');
  fs.writeFileSync(prdPath, `# Test Project V4

## Overview
A minimal HTTP API server for user authentication.

## Features
1. User registration endpoint
2. Login endpoint with JWT
3. Health check endpoint

## Tech Stack
- Node.js + Express
- SQLite for user storage
- bcrypt for password hashing
`);

  // Create constraints
  const constraintsPath = path.join(TEST_DIR, 'constraints.json');
  fs.writeFileSync(constraintsPath, JSON.stringify({
    language: 'javascript',
    framework: 'express',
    database: 'sqlite',
    max_memory_mb: 512
  }, null, 2));

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
    name: 'Test Integration V4',
    description: 'Testing remote git push + repo creation',
    requirements_dir: TEST_DIR,
    working_dir: TEST_DIR,
    constraints_json: constraintsPath,
  });
  console.log('Init result:', initRes.content[0].text);

  // Step 2: Bootstrap with DeepCode (Claude) — with timeout
  console.log('\nStep 2: Bootstrap project (via Claude)...');
  const bootstrapPromise = plugin.deepcodeBootstrap({
    project_id: PROJECT_ID,
    requirements_dir: TEST_DIR,
    constraints_json: constraintsPath,
    working_dir: TEST_DIR,
  });
  
  // 60s timeout for bootstrap
  const bootstrapTimeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Bootstrap timeout')), 60000));
  
  let bootstrapRes;
  try {
    bootstrapRes = await Promise.race([bootstrapPromise, bootstrapTimeout]);
    console.log('Bootstrap result:', bootstrapRes.content[0].text.substring(0, 500));
  } catch (e) {
    console.log('Bootstrap timed out or failed:', e.message);
    bootstrapRes = { content: [{ text: '{"success":false,"error":"' + e.message + '"}' }] };
  }

  // Step 3: Check files created
  console.log('\nStep 3: Check created files');
  const files = fs.readdirSync(TEST_DIR);
  console.log('Files in working dir:', files);

  // Step 4: Git milestone commit + create remote + push
  console.log('\nStep 4: Git commit + create remote repo + push');
  const gitRes = await plugin.gitMilestoneCommit({
    project_id: PROJECT_ID,
    message_prefix: 'feat(bootstrap)',
    milestone_name: 'v0.1.0-bootstrap',
    create_remote: true,
    remote_name: REPO_NAME,
    repo_visibility: 'public',
    push_remote: true,
  });
  const gitText = gitRes.content[0].text;
  console.log('Git result:', gitText.substring(0, 800));

  // Step 5: Verify remote repo
  console.log('\nStep 5: Verify remote repository');
  try {
    const remoteUrl = `https://github.com/windAndLiberty/${REPO_NAME}`;
    const checkRes = await new Promise((resolve) => {
      const child = spawn('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', remoteUrl]);
      let out = '';
      child.stdout.on('data', d => out += d);
      child.on('close', () => resolve(out.trim()));
    });
    console.log(`Remote repo check (HTTP ${checkRes}):`, checkRes === '200' ? 'EXISTS' : 'NOT FOUND');
  } catch (e) {
    console.log('Remote check error:', e.message);
  }

  // Step 6: Verify local git log
  console.log('\nStep 6: Local git log');
  try {
    const logRes = await new Promise((resolve) => {
      const child = spawn('git', ['log', '--oneline'], { cwd: TEST_DIR });
      let out = '';
      child.stdout.on('data', d => out += d);
      child.on('close', () => resolve(out.trim()));
    });
    console.log(logRes);
  } catch (e) {
    console.log('Git log error:', e.message);
  }

  // Step 7: Verify SSOT
  console.log('\nStep 7: SSOT facts');
  const ssotRes = await plugin.ssotQuery({
    project_id: PROJECT_ID,
    table: 'facts',
    filters: { entity: 'git' },
  });
  const facts = JSON.parse(ssotRes.content[0].text);
  console.log(`Found ${facts.length} git-related facts`);
  facts.forEach(f => console.log(`  - ${f.attribute}: ${String(f.value).substring(0, 60)}...`));

  console.log('\n=== Test Complete ===');

  // Summary
  const success = gitText.includes('success');
  console.log(`\nResult: ${success ? 'PASS' : 'FAIL'}`);
  if (success) {
    console.log(`Remote repo: https://github.com/windAndLiberty/${REPO_NAME}`);
  }
}

runTest().catch(console.error);

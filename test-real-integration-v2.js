/**
 * 端到端真实集成测试：验证 Git 远程推送 + 仓库创建 + 全链路集成
 * 测试目标：
 * 1. 初始化项目 → SSOT
 * 2. DeepCode Bridge (Claude bootstrap) 生成骨架
 * 3. Claude Code Bridge 增量开发
 * 4. Git 提交 + 创建远程仓库 + 推送
 * 5. 验证远程仓库内容
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const TEST_DIR = '/tmp/heop-real-test-v2';
const SSOT_DIR = '/tmp/heop-real-test-ssot-v2';
const PROJECT_ID = 'test-real-integration-v2';
const REPO_NAME = 'heop-test-repo-v2';

// Cleanup
if (fs.existsSync(TEST_DIR)) {
  fs.rmSync(TEST_DIR, { recursive: true });
}
fs.mkdirSync(TEST_DIR, { recursive: true });

if (fs.existsSync(SSOT_DIR)) {
  fs.rmSync(SSOT_DIR, { recursive: true });
}
fs.mkdirSync(SSOT_DIR, { recursive: true });

// Create PRD
const prdPath = path.join(TEST_DIR, 'PRD.md');
fs.writeFileSync(prdPath, `# Test Project V2

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

// Start HEOP MCP Server
const heopPath = path.join(__dirname, 'dist/index.js');
const server = spawn('node', [heopPath], {
  env: {
    ...process.env,
    SSOT_DATA_DIR: SSOT_DIR,
    KIMI_API_KEY: process.env.KIMI_API_KEY || '',
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
    ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL || 'https://api.kimi.com/coding/',
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});

let serverOutput = '';
server.stdout.on('data', (d) => { serverOutput += d.toString(); });
server.stderr.on('data', (d) => { serverOutput += d.toString(); });

function sendRequest(req) {
  return new Promise((resolve) => {
    const id = req.id || Date.now();
    const json = JSON.stringify({ jsonrpc: '2.0', id, ...req });
    server.stdin.write(json + '\n');
    
    const handler = (data) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const res = JSON.parse(line);
          if (res.id === id) {
            server.stdout.off('data', handler);
            resolve(res);
            return;
          }
        } catch {}
      }
    };
    server.stdout.on('data', handler);
    setTimeout(() => {
      server.stdout.off('data', handler);
      resolve({ error: { message: 'Timeout' } });
    }, 120000);
  });
}

async function runTest() {
  console.log('=== HEOP Real Integration Test V2 ===\n');
  
  // Wait for server init
  await new Promise(r => setTimeout(r, 2000));
  
  // Step 1: Initialize project
  console.log('Step 1: Initialize project');
  const initRes = await sendRequest({
    method: 'tools/call',
    params: {
      name: 'init_project',
      arguments: {
        project_id: PROJECT_ID,
        name: 'Test Integration V2',
        description: 'Testing remote git push + repo creation',
        requirements_dir: TEST_DIR,
        working_dir: TEST_DIR,
        constraints_json: path.join(TEST_DIR, 'constraints.json'),
      },
    },
  });
  console.log('Init result:', initRes.result?.content?.[0]?.text || initRes.error?.message);
  
  // Step 2: Bootstrap with DeepCode (Claude)
  console.log('\nStep 2: Bootstrap project (via Claude)...');
  const bootstrapRes = await sendRequest({
    method: 'tools/call',
    params: {
      name: 'deepcode_bootstrap',
      arguments: {
        project_id: PROJECT_ID,
        requirements_dir: TEST_DIR,
        constraints_json: path.join(TEST_DIR, 'constraints.json'),
        working_dir: TEST_DIR,
      },
    },
  });
  console.log('Bootstrap result:', bootstrapRes.result?.content?.[0]?.text || bootstrapRes.error?.message);
  
  // Step 3: Check files created
  console.log('\nStep 3: Check created files');
  const files = fs.readdirSync(TEST_DIR);
  console.log('Files in working dir:', files);
  
  // Step 4: Git milestone commit + create remote + push
  console.log('\nStep 4: Git commit + create remote repo + push');
  const gitRes = await sendRequest({
    method: 'tools/call',
    params: {
      name: 'git_milestone_commit',
      arguments: {
        project_id: PROJECT_ID,
        message_prefix: 'feat(bootstrap)',
        milestone_name: 'v0.1.0-bootstrap',
        create_remote: true,
        remote_name: REPO_NAME,
        repo_visibility: 'public',
        push_remote: true,
      },
    },
  });
  const gitText = gitRes.result?.content?.[0]?.text || gitRes.error?.message;
  console.log('Git result:', gitText);
  
  // Step 5: Verify remote repo
  console.log('\nStep 5: Verify remote repository');
  try {
    const remoteUrl = `https://github.com/windAndLiberty/${REPO_NAME}`;
    const checkRes = await new Promise((resolve, reject) => {
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
    const logRes = await new Promise((resolve, reject) => {
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
  const ssotRes = await sendRequest({
    method: 'tools/call',
    params: {
      name: 'ssot_query',
      arguments: {
        project_id: PROJECT_ID,
        entity: 'git',
      },
    },
  });
  const facts = JSON.parse(ssotRes.result?.content?.[0]?.text || '[]');
  console.log(`Found ${facts.length} git-related facts`);
  facts.forEach(f => console.log(`  - ${f.attribute}: ${f.value.substring(0, 60)}...`));
  
  // Cleanup
  server.stdin.end();
  server.kill();
  
  console.log('\n=== Test Complete ===');
  
  // Summary
  const success = !gitRes.error && gitText.includes('success');
  console.log(`\nResult: ${success ? 'PASS' : 'FAIL'}`);
  if (success) {
    console.log(`Remote repo: https://github.com/windAndLiberty/${REPO_NAME}`);
  }
}

runTest().catch(console.error);

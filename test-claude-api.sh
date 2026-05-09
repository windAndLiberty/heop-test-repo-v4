#!/bin/bash
# Test Claude Code with API key directly
export ANTHROPIC_API_KEY="9xyma0urWezvAiBwFuID"
echo "API Key: ${ANTHROPIC_API_KEY:0:5}..."
echo "Create file /tmp/claude_api_test.txt with 'hello from api'" | claude 2>&1 | head -30

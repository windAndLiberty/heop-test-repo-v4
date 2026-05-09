#!/bin/bash
# Test if claude can run in non-interactive mode
echo "Testing claude direct execution..."
cd /tmp
echo "Create a file test.txt with content 'hello'" | claude 2>&1 | tee /tmp/claude_output.log
echo "Exit code: $?"

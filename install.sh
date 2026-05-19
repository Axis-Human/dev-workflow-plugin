#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Banner
# ---------------------------------------------------------------------------
_C='\033[0;36m'   # cyan
_P='\033[0;35m'   # purple
_D='\033[2;37m'   # dim white
_R='\033[0m'      # reset

print_banner() {
  echo -e "${_P}"
  cat << 'WORDMARK'
 █████╗   ██╗  ██╗   ██╗   ███████╗        ██╗  ██╗   ██╗   ██╗   ███╗   ███╗    █████╗    ███╗   ██╗
██╔══██╗  ╚██╗██╔╝   ██║   ██╔════╝        ██║  ██║   ██║   ██║   ████╗ ████║   ██╔══██╗   ████╗  ██║
███████║   ╚███╔╝    ██║   ███████╗        ███████║   ██║   ██║   ██╔████╔██║   ███████║   ██╔██╗ ██║
██╔══██║   ██╔██╗    ██║   ╚════██║        ██╔══██║   ██║   ██║   ██║╚██╔╝██║   ██╔══██║   ██║╚██╗██║
██║  ██║  ██╔╝ ██╗   ██║   ███████║        ██║  ██║   ╚██████╔╝   ██║ ╚═╝ ██║   ██║  ██║   ██║ ╚████║
╚═╝  ╚═╝  ╚═╝  ╚═╝   ╚═╝   ╚══════╝        ╚═╝  ╚═╝    ╚═════╝    ╚═╝     ╚═╝   ╚═╝  ╚═╝   ╚═╝  ╚═══╝
WORDMARK
  echo -e "${_D}"
  echo   "                      dev-workflow-plugin  ·  installer"
  echo -e "${_R}"
}

print_banner

SETTINGS_FILE="$HOME/.claude/settings.json"

# ---------------------------------------------------------------------------
# 1. Install the plugin
# ---------------------------------------------------------------------------
echo "Adding marketplace source..."
claude plugin marketplace add axis-human/dev-workflow-plugin

echo "Installing axis-human-ai-toolbox plugin..."
claude plugin install axis-human-ai-toolbox

# ---------------------------------------------------------------------------
# 2. Ensure settings file exists (node requires valid JSON to parse)
# ---------------------------------------------------------------------------
if [ ! -f "$SETTINGS_FILE" ]; then
  echo "{}" > "$SETTINGS_FILE"
fi

# ---------------------------------------------------------------------------
# 3. Merge hooks into settings.json (node is bundled with Claude Code)
# ---------------------------------------------------------------------------
echo "Configuring hooks in $SETTINGS_FILE..."

node - "$SETTINGS_FILE" <<'JS'
const fs = require('fs');
const file = process.argv[2];
const settings = JSON.parse(fs.readFileSync(file, 'utf8'));

const UPS_CMD = "echo 'MANDATORY ACTION: Before doing anything else, invoke the axis-human-ai-toolbox:orchestrator-agent agent to handle this request.'";
const SS_CMD  = "echo 'MANDATORY ACTION: A subagent started. Record a dedicated analytics trace for this delegated execution, setting callerAgent to orchestrator-agent, invokedName to the subagent name, invocationType to agent, and callCount to reflect the number of delegations so far for this interaction.'";

if (!settings.hooks) settings.hooks = {};

function commandPresent(entries, cmd) {
  return (entries || []).some(e => (e.hooks || []).some(h => h.command === cmd));
}

if (!commandPresent(settings.hooks.UserPromptSubmit, UPS_CMD)) {
  settings.hooks.UserPromptSubmit = settings.hooks.UserPromptSubmit || [];
  settings.hooks.UserPromptSubmit.push({ matcher: "", hooks: [{ type: "command", command: UPS_CMD }] });
}

if (!commandPresent(settings.hooks.SubagentStart, SS_CMD)) {
  settings.hooks.SubagentStart = settings.hooks.SubagentStart || [];
  settings.hooks.SubagentStart.push({ hooks: [{ type: "command", command: SS_CMD }] });
}

fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
console.log('Hooks configured successfully.');
JS

echo ""
echo "Installation complete."
echo "  Plugin : axis-human-ai-toolbox"
echo "  Hooks  : UserPromptSubmit, SubagentStart"

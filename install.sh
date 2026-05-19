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
# 2. Ensure settings file exists
# ---------------------------------------------------------------------------
if [ ! -f "$SETTINGS_FILE" ]; then
  echo "{}" > "$SETTINGS_FILE"
fi

# ---------------------------------------------------------------------------
# 3. Merge hooks into settings.json (Python used for safe JSON handling)
# ---------------------------------------------------------------------------
echo "Configuring hooks in $SETTINGS_FILE..."

python3 - "$SETTINGS_FILE" <<'PYTHON'
import json, sys

settings_file = sys.argv[1]

with open(settings_file, "r") as f:
    settings = json.load(f)

user_prompt_hook = {
    "matcher": "",
    "hooks": [
        {
            "type": "command",
            "command": "echo 'MANDATORY ACTION: Before doing anything else, invoke the axis-human-ai-toolbox:orchestrator-agent agent to handle this request.'"
        }
    ]
}

subagent_hook = {
    "hooks": [
        {
            "type": "command",
            "command": "echo 'MANDATORY ACTION: A subagent started. Record a dedicated analytics trace for this delegated execution, setting callerAgent to orchestrator-agent, invokedName to the subagent name, invocationType to agent, and callCount to reflect the number of delegations so far for this interaction.'"
        }
    ]
}

if "hooks" not in settings:
    settings["hooks"] = {}

def command_present(hook_entries, target_command):
    return any(
        any(h.get("command") == target_command for h in entry.get("hooks", []))
        for entry in hook_entries
    )

# UserPromptSubmit
ups_cmd = user_prompt_hook["hooks"][0]["command"]
ups_list = settings["hooks"].get("UserPromptSubmit", [])
if not command_present(ups_list, ups_cmd):
    ups_list.append(user_prompt_hook)
settings["hooks"]["UserPromptSubmit"] = ups_list

# SubagentStart
ss_cmd = subagent_hook["hooks"][0]["command"]
ss_list = settings["hooks"].get("SubagentStart", [])
if not command_present(ss_list, ss_cmd):
    ss_list.append(subagent_hook)
settings["hooks"]["SubagentStart"] = ss_list

with open(settings_file, "w") as f:
    json.dump(settings, f, indent=2)
    f.write("\n")

print("Hooks configured successfully.")
PYTHON

echo ""
echo "Installation complete."
echo "  Plugin : axis-human-ai-toolbox"
echo "  Hooks  : UserPromptSubmit, SubagentStart"

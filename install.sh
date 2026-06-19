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

print_usage() {
  cat <<USAGE
Usage: install.sh [TARGET]

Targets:
  --claude     Install for Claude Code.
  --opencode   Install for OpenCode (skills + converted agents).
  --all        Install for both Claude Code and OpenCode.
  -h, --help   Show this help.

If no target is given, an interactive menu is shown.
USAGE
}

# ---------------------------------------------------------------------------
# Arg parsing
# ---------------------------------------------------------------------------
TARGET=""
if [ "$#" -gt 0 ]; then
  case "$1" in
    --claude)   TARGET="claude" ;;
    --opencode) TARGET="opencode" ;;
    --all)      TARGET="all" ;;
    -h|--help)  print_banner; print_usage; exit 0 ;;
    *)          echo "Unknown argument: $1" >&2; print_usage; exit 1 ;;
  esac
fi

print_banner

# ---------------------------------------------------------------------------
# Interactive menu (used when no flag is passed)
# ---------------------------------------------------------------------------
prompt_choice() {
  local choice=""
  while :; do
    echo "Select an option:"
    echo "  1) Install for Claude Code"
    echo "  2) Install for OpenCode"
    echo "  3) Install for both"
    echo "  4) Exit"
    printf "> "

    if [ -t 0 ]; then
      if ! read -r choice; then
        echo ""; echo "Aborted."; exit 0
      fi
    else
      choice="$( { read -r line < /dev/tty && printf '%s' "$line"; } 2>/dev/null )" || true
      if [ -z "$choice" ] && ! { : < /dev/tty; } 2>/dev/null; then
        echo ""
        echo "No TTY available. Re-run with --claude, --opencode, or --all." >&2
        exit 1
      fi
    fi

    case "$choice" in
      1) TARGET="claude";   return ;;
      2) TARGET="opencode"; return ;;
      3) TARGET="all";      return ;;
      4) echo "Aborted."; exit 0 ;;
      *) echo "Invalid choice: $choice"; echo "" ;;
    esac
  done
}

if [ -z "$TARGET" ]; then
  prompt_choice
fi

# ---------------------------------------------------------------------------
# SSH detection & HTTPS fallback
#
#   Claude Code's plugin manager may use SSH URLs (git@github.com:…) internally.
#   When SSH keys are not configured, plugin install fails. This block detects
#   that scenario and temporarily configures git to rewrite SSH URLs to HTTPS.
# ---------------------------------------------------------------------------
_HTTPS_REWRITE_ADDED=false

trap cleanup_https_fallback EXIT

_ssh_works() {
  ssh -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new \
      -T git@github.com 2>&1 | grep -qi "successfully authenticated"
}

ensure_https_fallback() {
  if _ssh_works; then
    return
  fi

  # Check if the user already has the rewrite configured
  if git config --global --get url."https://github.com/".insteadOf >/dev/null 2>&1; then
    echo "SSH not available — HTTPS rewrite already configured, continuing."
    return
  fi

  echo "SSH not available — configuring git to use HTTPS for github.com..."
  git config --global url."https://github.com/".insteadOf "git@github.com:"
  _HTTPS_REWRITE_ADDED=true
}

cleanup_https_fallback() {
  if [ "$_HTTPS_REWRITE_ADDED" = true ]; then
    echo "Cleaning up temporary HTTPS rewrite..."
    git config --global --unset url."https://github.com/".insteadOf || true
    _HTTPS_REWRITE_ADDED=false
  fi
}


# ---------------------------------------------------------------------------
# Source-dir resolution
#
#   Local invocation (./install.sh)  → use the script's own directory.
#   Curl pipe (curl ... | bash)      → clone the repo into a stable cache.
# ---------------------------------------------------------------------------
PLUGIN_REPO="https://github.com/Axis-Human/dev-workflow-plugin.git"
PLUGIN_CACHE="$HOME/.local/share/dev-workflow-plugin"
SOURCE_DIR=""

resolve_source_dir() {
  [ -n "$SOURCE_DIR" ] && return

  local src="${BASH_SOURCE[0]:-}"
  if [ -n "$src" ] && [ -f "$src" ]; then
    SOURCE_DIR="$(cd "$(dirname "$src")" && pwd)"
    return
  fi

  if [ -d "$PLUGIN_CACHE/.git" ]; then
    echo "Updating plugin cache at $PLUGIN_CACHE..."
    git -C "$PLUGIN_CACHE" pull --ff-only --quiet
  else
    echo "Cloning plugin into $PLUGIN_CACHE..."
    mkdir -p "$(dirname "$PLUGIN_CACHE")"
    git clone --quiet "$PLUGIN_REPO" "$PLUGIN_CACHE"
  fi
  SOURCE_DIR="$PLUGIN_CACHE"
}

# ---------------------------------------------------------------------------
# Claude Code install
# ---------------------------------------------------------------------------
install_claude_code() {
  ensure_https_fallback

  echo "Adding marketplace source..."
  claude plugin marketplace add axis-human/dev-workflow-plugin

  echo "Installing axis-human-ai-toolbox plugin..."
  claude plugin install axis-human-ai-toolbox

  cleanup_https_fallback

  echo ""
  echo "Claude Code install complete."
  echo "  Plugin : axis-human-ai-toolbox"
  echo "  Hooks  : bundled with the plugin (UserPromptSubmit, SubagentStart, PreToolUse guard)"
}

# ---------------------------------------------------------------------------
# OpenCode — skills (symlinked from the local clone)
# ---------------------------------------------------------------------------
install_opencode_skills() {
  resolve_source_dir
  local skills_src="$SOURCE_DIR/skills"
  local skills_dst="$HOME/.config/opencode/skills"

  if [ ! -d "$skills_src" ]; then
    echo "Error: no skills/ directory in $SOURCE_DIR" >&2
    exit 1
  fi

  mkdir -p "$skills_dst"
  echo "Linking skills into $skills_dst..."

  local installed=0 skipped=0
  for skill_dir in "$skills_src"/*/; do
    [ -d "$skill_dir" ] || continue
    [ -f "$skill_dir/SKILL.md" ] || continue
    local name; name="$(basename "$skill_dir")"
    local target="$skills_dst/$name"

    if [ -L "$target" ]; then
      rm "$target"
    elif [ -e "$target" ]; then
      echo "  skip $name (real directory at $target — remove it manually to re-link)"
      skipped=$((skipped + 1))
      continue
    fi

    ln -s "${skill_dir%/}" "$target"
    echo "  link $name"
    installed=$((installed + 1))
  done

  echo "  Linked  : $installed"
  if [ "$skipped" -gt 0 ]; then
    echo "  Skipped : $skipped"
  fi
}

# ---------------------------------------------------------------------------
# OpenCode — agents (converted from Claude-shaped frontmatter)
# ---------------------------------------------------------------------------
install_opencode_agents() {
  resolve_source_dir
  local agents_src="$SOURCE_DIR/agents"
  local agents_dst="$HOME/.config/opencode/agents"

  if [ ! -d "$agents_src" ]; then
    echo "Error: no agents/ directory in $SOURCE_DIR" >&2
    exit 1
  fi

  mkdir -p "$agents_dst"
  echo "Converting agents into $agents_dst..."

  node - "$agents_src" "$agents_dst" <<'JS'
const fs = require('fs');
const path = require('path');

const [, , srcDir, dstDir] = process.argv;

const PRIMARY_AGENT = 'orchestrator-agent';
const WRITE_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit']);
const BASH_TOOLS  = new Set(['Bash']);

function parseFrontmatter(text) {
  if (!text.startsWith('---\n')) return { fm: {}, body: text };
  const end = text.indexOf('\n---', 4);
  if (end === -1) return { fm: {}, body: text };
  const fmRaw = text.slice(4, end);
  const body = text.slice(end + 4).replace(/^\n/, '');
  return { fm: parseYamlSubset(fmRaw), body };
}

// Tiny YAML subset: top-level scalars, multiline `>` blocks, and `key:` lists of `- value`.
function parseYamlSubset(raw) {
  const lines = raw.split('\n');
  const out = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) { i++; continue; }

    const m = line.match(/^([a-zA-Z_][\w-]*)\s*:\s*(.*)$/);
    if (!m) { i++; continue; }
    const key = m[1];
    const rest = m[2];

    if (rest === '>' || rest === '|') {
      const buf = [];
      i++;
      while (i < lines.length && (lines[i].startsWith('  ') || lines[i] === '')) {
        buf.push(lines[i].replace(/^  /, ''));
        i++;
      }
      out[key] = buf.join(rest === '>' ? ' ' : '\n').trim();
      continue;
    }

    if (rest === '') {
      // possibly a list
      const items = [];
      let j = i + 1;
      while (j < lines.length && /^\s*-\s+/.test(lines[j])) {
        items.push(lines[j].replace(/^\s*-\s+/, '').trim());
        j++;
      }
      if (items.length) {
        out[key] = items;
        i = j;
        continue;
      }
      out[key] = '';
      i++;
      continue;
    }

    out[key] = rest.replace(/^["']|["']$/g, '');
    i++;
  }
  return out;
}

function buildOpenCodeFrontmatter(name, fm) {
  const lines = ['---'];

  const mode = name === PRIMARY_AGENT ? 'primary' : 'subagent';
  if (fm.description) {
    const desc = String(fm.description).replace(/\s+/g, ' ').trim();
    lines.push(`description: ${JSON.stringify(desc)}`);
  }
  lines.push(`mode: ${mode}`);
  if (fm.model) lines.push(`model: ${fm.model}`);

  const tools = Array.isArray(fm.tools) ? fm.tools : [];
  const canWrite = tools.some(t => WRITE_TOOLS.has(t));
  const canBash  = tools.some(t => BASH_TOOLS.has(t));
  lines.push('tools:');
  lines.push(`  write: ${canWrite}`);
  lines.push(`  bash: ${canBash}`);

  lines.push('---');
  return lines.join('\n');
}

const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.md'));
let converted = 0;
for (const file of files) {
  const full = path.join(srcDir, file);
  const text = fs.readFileSync(full, 'utf8');
  const { fm, body } = parseFrontmatter(text);
  const name = (fm.name || path.basename(file, '.md')).trim();

  const newFm = buildOpenCodeFrontmatter(name, fm);
  const out   = `${newFm}\n\n${body}`;
  fs.writeFileSync(path.join(dstDir, `${name}.md`), out);
  const role = name === PRIMARY_AGENT ? 'primary' : 'subagent';
  console.log(`  convert ${name} (${role})`);
  converted++;
}
console.log(`  Converted : ${converted}`);
JS
}

install_opencode() {
  install_opencode_skills
  echo ""
  install_opencode_agents
  echo ""
  echo "OpenCode install complete."
  echo "  Skills : $HOME/.config/opencode/skills   (symlinks — auto-update via git pull)"
  echo "  Agents : $HOME/.config/opencode/agents   (converted copies — re-run install to update)"
  echo "  Source : $SOURCE_DIR"
}

# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------
case "$TARGET" in
  claude)
    install_claude_code
    ;;
  opencode)
    install_opencode
    ;;
  all)
    install_claude_code
    echo ""
    install_opencode
    ;;
esac

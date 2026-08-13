---
name: wiki-connect
description: Connects (clones) a wiki that already exists in a remote Git repository so it can be queried locally. Use when the user wants to attach, link, or clone an existing wiki from another repo — not to create a new one from scratch (use /wiki-init for that).
allowed-tools: Bash AskUserQuestion
effort: low
---

# wiki-connect

Clones an existing wiki repository so it is available locally for querying
with `/wiki-query` and syncing with `/wiki-sync`.

This skill does **not** create a new wiki — it connects to one that already
exists in a remote Git repository. For creating a wiki from scratch, use
`/wiki-init` instead.

Prerequisites: the user must have `git` installed and authenticated
(SSH keys, Git Credential Manager, or any mechanism they normally use).
This skill does not manage tokens or credentials — it relies on the user's
existing git setup.

---

## Step 1 — Check that git is installed

Detect the operating system and verify git is available:

```bash
git --version
```

If the command fails (git not found), give the user precise installation
instructions for their OS:

- **Windows**: download from https://git-scm.com/download/win, or run
  `winget install --id Git.Git -e --source winget` if winget is available.
  After installing, the user must open a new terminal or session — the
  current session will not see the updated PATH.

- **macOS**: run `brew install git` if Homebrew is installed, or install
  Xcode Command Line Tools with `xcode-select --install`, or download from
  https://git-scm.com/download/mac.

- **Linux**: use the distribution's package manager if detectable
  (`apt install git`, `dnf install git`, `pacman -S git`), or point to
  https://git-scm.com/download/linux.

After giving instructions, stop and wait for the user to confirm they
installed git. Then re-run `git --version` to verify before continuing.

---

## Step 2 — Ask for the repository URL

Ask the user for the URL of the wiki repository using `AskUserQuestion`:

- Question: "What is the URL of the Git repository where the wiki lives?
  (e.g. https://github.com/org/wiki or git@github.com:org/wiki.git)"
- Header: "Wiki repository URL"
- Let the user type in "Other"

Accept both HTTPS and SSH URLs — do not block or discourage either format.

---

## Step 3 — Ask where to clone

Ask where the wiki should be cloned using `AskUserQuestion`:

- Question: "Where should the wiki be cloned?"
- Header: "Clone destination"
- Options:
  - "Current directory (default)" — clone into the current working directory
  - "Choose a different path" — let the user type a custom path

If the user selects the default, use the current working directory. If they
choose a custom path, ask for it as free text.

Compute the final target path: if the URL ends in `/wiki.git` or `/wiki`,
git will create a `wiki/` subdirectory by default. Let git's default naming
apply unless the user explicitly specified a full target path.

---

## Step 4 — Clone the repository

Run the clone directly — no preliminary access check needed, the clone
itself validates everything:

```bash
git clone <url> <target>
```

### If the clone succeeds

Continue to Step 5.

### If the clone fails

Classify the error from stderr into one of two cases:

**Authentication problem** — stderr contains patterns like "could not read
Username", "Authentication failed", "Permission denied", "403", or a
username/password prompt failure:

Tell the user:

> The clone failed because git could not authenticate. This usually means
> the credential flow needs an interactive prompt that cannot run from
> this automated session.
>
> Please run this command yourself in your own terminal:
> ```
> git clone <url> <target>
> ```
> Your system's native credential dialog (Git Credential Manager, browser
> OAuth flow, SSH passphrase prompt) will appear and let you authenticate.
> Once it finishes, let me know and I will continue from here.

After the user confirms, verify the clone landed by checking that `<target>/.git`
exists. If it does, continue to Step 5.

**Repository not found** — stderr contains patterns like "repository not
found", "not found", "does not exist":

Tell the user to double-check the owner, repo name, and URL, then go back
to Step 2 to re-enter it.

---

## Step 5 — Confirm

Resolve the absolute path of the cloned directory and report to the user:

```
Wiki cloned successfully.

Location: <absolute-path>

To query or sync this wiki in future sessions, open your session from
this directory:
  <absolute-path>
```

This ends the skill.

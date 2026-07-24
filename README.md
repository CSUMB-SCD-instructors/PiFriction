# Pi Friction Classroom

Classroom extensions for Pi.

## Chat mode

`extensions/chat-mode.ts` starts Pi in a tutoring-oriented chat mode:

- shows a custom startup header explaining chat mode
- disables shell commands, search/list tools, edits, and writes
- leaves only `read` active
- blocks `read` unless an actual file was explicitly referenced with `@path` in the current prompt or manually allowlisted for the current prompt
- ignores `@` references to directories or missing paths
- adds system-prompt instructions to behave like a tutor/chat assistant rather than an autonomous coding agent
- adds screenshot guidance when images are attached

Commands:

```text
/pifriction-help      Show all PiFriction modes and commands
/chat                 Toggle tutoring-only chat mode
/chat-help            Show student-facing chat mode help
/chat-allow <file...> Allow specific files to be read for the current prompt
/chat-clear           Clear current-prompt allowed files
/plan                 Toggle read-only project planning mode
/plan-help            Show planning mode help
/guided               Toggle guided coding mode
/guided-help          Show guided coding mode help
/detective            Toggle Change Detective review mode
/detective-help       Show Change Detective mode help
```

Example:

```text
I have this error: ... What does it mean?
Hey, I'm running into an issue in @src/main.py. Can you look at it for me?
```

## Change Detective mode

Use `/detective` for an agentic code-review exercise. Pi can inspect and search the project, and it can propose edits, but the extension pauses every concrete `edit` or `write` request before it reaches disk.

For each candidate change, the student chooses:

1. **Looks good** — Pi must retry the exact same reviewed change before it can apply it.
2. **Something is wrong** — the student identifies a mismatch, missing case, broken invariant, boundary problem, or other concern. Pi evaluates the diagnosis, explains it, and proposes a corrected candidate for another review.

The extension, rather than the model, randomly schedules fault exercises (`FAULT_EXERCISE_RATE` is currently 35%). When scheduled, Pi receives a hidden directive to make the next first candidate contain one plausible review defect; corrected candidates must be sound. Change Detective forces Pi thinking to `off` for the duration of the mode and restores the prior setting when it exits, so model scratch work and hidden exercise instructions are not exposed. If a student approves a deliberately flawed candidate, it explains the missed issue and does **not** apply it in this beta. Shell commands are disabled so changes cannot bypass the review gate. The mode formats every exact replacement in an `edit` call (including multiple replacements), and blocks `write` against existing files so a localized edit cannot turn into an unreadable whole-file rewrite.

## Planning mode

Use `/plan` for read-only, project-level exploration:

1. Pi inspects the relevant architecture, data flow, and constraints.
2. It offers 2–3 plausible approaches without calling one “recommended.” Each includes intended behavior, likely affected files/functions, a tradeoff or pitfall, and a verification strategy.
3. The student chooses an approach and explains why it fits better than an alternative.
4. After Pi accepts that reasoning, it transitions to `/guided`; guided mode implements the selected approach one small unit at a time.

Planning mode can list directories, find files, search code, and read relevant files. It cannot run arbitrary shell commands or edit files. The editable implementation path is deliberately only `/plan` → choice/justification → `/guided` → per-unit explain-back.

The project-plan and choice-assessment prompts are near the top of `extensions/plan-mode.ts` for quick tuning.

## Guided coding mode

Use `/guided` to enter the first guided-coding beta:

1. Pi can inspect an explicitly requested coding task but cannot change files.
2. It chooses **one small implementation unit**—normally one function—and provides a concise change outline: likely file, intended operations, and a verification approach. For a new codebase it should start with an easy, self-contained foundational function rather than a difficult shared dependency. It does not provide a full rationale or patch.
3. The student explains that unit's purpose and mechanism in their own words, and identifies a unit-specific risk, edge case, or alternative.
4. Pi asks a targeted follow-up if the explanation is insufficient. If the student says a relevant part is confusing, Pi must teach that concept and keep edits locked.
5. Once it accepts the explanation, it unlocks edits for that one agreed unit only. The next function requires another guided cycle.

Use `/guided-help` for the student-facing explanation. This initial version uses ordinary chat rather than a dedicated UI. Its pedagogical prompts are centralized near the top of `extensions/guided-mode.ts` (`PROPOSAL_INSTRUCTIONS`, `ASSESSMENT_INSTRUCTIONS`, and `IMPLEMENTATION_INSTRUCTIONS`) for quick iteration.

For this first beta, guided mode intentionally does not expose `bash`: shell commands could otherwise bypass the edit/write gate. A later version can add narrowly allowlisted test commands.

## Test locally

```bash
pi -e ./extensions/chat-mode.ts
```

## Docker image

For local development, the easiest launcher is:

```bash
./run-pifriction.sh "$HOME/scratch/CST334"
```

It optionally loads `ANTHROPIC_API_KEY` from a repository-root `.env` file, builds the image, and mounts the supplied directory at `/data`. After Pi starts, its TUI asks whether to use chat or guided coding mode. Give the script a different project directory as its first argument, or omit the argument to use `$HOME/scratch/CST334`.

Build manually:

```bash
docker build -t pifriction .
```

Run from a project directory:

```bash
docker run -it --rm \
  -v "$PWD":/data \
  -e PIFRICTION_ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
  pifriction
```

For persistent Pi sessions/settings:

```bash
docker run -it --rm \
  -v "$PWD":/data \
  -v "$HOME/.pifriction-pi":/home/pifriction/.pi \
  -e PIFRICTION_ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
  pifriction
```

The image includes Pi plus common student/project tools: Node.js/npm, Python 3/pip/venv, git, ripgrep, fd, jq, curl, tree, zip/unzip, ssh client, and a basic editor.

The entrypoint always loads this package with `pi -e /opt/pifriction`, so chat mode stays active even when students mount persistent Pi settings.

## Model/provider selection

The image accepts either provider's normal environment variable or a PiFriction-prefixed equivalent:

```text
OPENROUTER_API_KEY / PIFRICTION_OPENROUTER_API_KEY
ANTHROPIC_API_KEY  / PIFRICTION_ANTHROPIC_API_KEY
```

If both are available, **OpenRouter is preferred** and the image defaults to:

```text
openrouter/~anthropic/claude-sonnet-latest
```

If only Anthropic is available, it defaults to:

```text
anthropic/claude-sonnet-4-5
```

Override the default model for a run with `PIFRICTION_MODEL`:

```bash
docker run -it --rm \
  -v "$PWD":/data \
  -e PIFRICTION_OPENROUTER_API_KEY="$OPENROUTER_API_KEY" \
  -e PIFRICTION_MODEL="openrouter/~anthropic/claude-haiku-latest" \
  pifriction
```

An explicit final CLI model argument also wins, for example `pifriction --model anthropic/claude-sonnet-4-6`.

### Screenshots/images in Docker

This package includes [pi-image-paste](https://www.npmjs.com/package/pi-image-paste), which converts dragged or pasted image paths into first-class image attachments with automatic optimization. When running natively (not in Docker), dragging a screenshot into the terminal or pasting a path will attach the image directly.

In Docker, image paths are host paths that do not exist inside the container, so path-based drag-and-drop will not work. Clipboard image forwarding into Docker containers is also generally unreliable.

Most reliable options for Docker students:

1. **Save screenshots into the mounted project folder** (`$PWD`), then drag or paste the path — the container mounts that directory, so it can read the file.
2. **Paste exact error text** when precision matters — copy/paste text always works.
3. If you want to also mount macOS screenshot temp folders, you can add extra `-v` flags to the `docker run` command, but this is not recommended for general use.

## Install as a package

From this directory:

```bash
pi install ./
```

Or distribute via git/npm and install with:

```bash
pi install git:github.com/<you>/<repo>@v0.1.0
# or
pi install npm:<package-name>@0.1.0
```

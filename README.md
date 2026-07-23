# Pi Friction Classroom

Classroom extensions for Pi.

## Chat mode

`extensions/chat-mode.ts` starts Pi in a tutoring-oriented chat mode:

- disables shell commands, search/list tools, edits, and writes
- leaves only `read` active
- blocks `read` unless the file was explicitly referenced with `@path` in the current prompt or manually allowlisted for the current prompt
- adds system-prompt instructions to behave like a tutor/chat assistant rather than an autonomous coding agent

Commands:

```text
/chat                 Toggle chat mode
/chat-allow <file...> Allow specific files to be read for the current prompt
/chat-clear           Clear current-prompt allowed files
```

Example:

```text
I have this error: ... What does it mean?
Hey, I'm running into an issue in @src/main.py. Can you look at it for me?
```

## Test locally

```bash
pi -e ./extensions/chat-mode.ts
```

## Docker image

Build:

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

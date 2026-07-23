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
/chat                 Toggle chat mode
/chat-help            Show student-facing chat mode help
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

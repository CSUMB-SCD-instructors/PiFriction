# Pi Friction Classroom

Classroom extensions for Pi.

## Chat mode

`extensions/chat-mode.ts` starts Pi in a tutoring-oriented chat mode:

- disables shell commands, search/list tools, edits, and writes
- leaves only `read` active
- blocks `read` unless the file was explicitly referenced with `@path` or allowlisted
- adds system-prompt instructions to behave like a tutor/chat assistant rather than an autonomous coding agent

Commands:

```text
/chat                 Toggle chat mode
/chat-allow <file...> Allow specific files to be read manually
/chat-clear           Clear allowed files
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

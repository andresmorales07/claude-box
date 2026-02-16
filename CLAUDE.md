# Claude Box - Project Guide

## Overview

Claude Box is a Dockerized Claude Code environment with multi-machine access via SSH (port 2222) and a web terminal (port 7681, ttyd). It uses s6-overlay for process supervision.

## Architecture Overview

The container is built on Debian bookworm-slim and layers in three main subsystems:

1. **Process supervision (s6-overlay v3)** — the container entrypoint is `/init`, which boots the s6 service tree. Services are declared under `rootfs/etc/s6-overlay/s6-rc.d/`:
   - `init` (oneshot) — generates SSH host keys, sets the `claude` user password, fixes volume ownership.
   - `sshd` (longrun) — OpenSSH daemon on port 2222.
   - `ttyd` (longrun) — web terminal on port 7681 (basic-auth via `TTYD_USERNAME`/`TTYD_PASSWORD`).
   - `user` (bundle) — depends on all of the above; ensures correct startup order.

2. **Claude Code** — installed globally via `npm install -g @anthropic-ai/claude-code`. Authenticated with `CLAUDE_CODE_OAUTH_TOKEN` (OAuth, not API key). Node.js 20 LTS is included for MCP server support.

3. **Networking** — two exposed ports:
   - `2222` — SSH access (`ssh -p 2222 claude@<host>`)
   - `7681` — ttyd web terminal (`http://<host>:7681`)

Two Docker volumes persist state across container restarts:
- `claude-config` → `/home/claude/.claude`
- `workspace` → `/home/claude/workspace`

## Project Structure

```
├── Dockerfile              # Debian bookworm-slim, Node.js 20, s6-overlay, ttyd, Claude Code
├── docker-compose.yml      # Service definition (pulls from GHCR), volumes, env vars
├── Makefile                # build, up, down, logs, shell, ssh, clean
├── .env.example            # Template for CLAUDE_CODE_OAUTH_TOKEN and passwords
└── rootfs/                 # Files copied into the container at /
    └── etc/
        ├── ssh/sshd_config
        └── s6-overlay/
            ├── scripts/init.sh          # Oneshot: SSH keys, user password, volume ownership
            └── s6-rc.d/
                ├── init/                # Oneshot service (runs init.sh)
                ├── sshd/                # Long-running SSH daemon
                ├── ttyd/                # Long-running web terminal
                └── user/                # Bundle: init + sshd + ttyd
```

## Common Commands

```bash
# Build & lifecycle
make build    # Build the Docker image locally (for development)
make up       # Start the container (detached, pulls from GHCR by default)
make down     # Stop the container
make clean    # Stop, remove volumes and image

# Access
make shell    # Exec into the running container as `claude` user
make ssh      # SSH into the container (port 2222)
make logs     # Tail container logs (s6 + services)

# Inside the container
claude        # Launch Claude Code CLI
```

## Authentication

Uses `CLAUDE_CODE_OAUTH_TOKEN` (OAuth token from `claude setup-token`) — not `ANTHROPIC_API_KEY`. If `ANTHROPIC_API_KEY` is set, Claude Code will use API billing instead of the Max/Pro subscription, so never set both.

## Key Conventions

- Container runs as `claude` user (uid 1000) with passwordless sudo
- Two Docker volumes: `claude-config` (~/.claude) and `workspace` (~/workspace)
- s6-overlay v3 service types: `oneshot` for init, `longrun` for sshd/ttyd, `bundle` for user
- `S6_KEEP_ENV=1` ensures environment variables propagate to all services
- sshd `AcceptEnv` allows `CLAUDE_CODE_OAUTH_TOKEN` to pass through SSH sessions

## Testing Strategy

There is no automated test suite. Verify changes manually:

1. **Build** — `make build` must complete without errors.
2. **Startup** — `make up` then `docker compose ps` should show the container as healthy (healthcheck curls `http://localhost:7681`).
3. **SSH access** — `make ssh` (or `ssh -p 2222 claude@localhost`) should connect and drop into a bash shell.
4. **Web terminal** — open `http://localhost:7681` in a browser, authenticate with `TTYD_USERNAME`/`TTYD_PASSWORD`.
5. **Claude Code** — run `claude` inside the container and confirm it authenticates with the provided OAuth token.
6. **Volume persistence** — `make down && make up`, then verify files in `~/workspace` and `~/.claude` survived the restart.
7. **CI** — GitHub Actions runs `docker compose build` and verifies the image starts and passes its healthcheck.

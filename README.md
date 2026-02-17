# Claude Box

Dockerized Claude Code with multi-machine access. Configure once, connect from anywhere via SSH or browser. Supports Docker-in-Docker via [Sysbox](https://github.com/nestybox/sysbox) for secure container builds inside the sandbox.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (with Compose v2)

## Quick Start

```bash
# 1. Clone and configure
git clone https://github.com/andresmorales07/claude-box.git
cd claude-box
cp .env.example .env            # edit .env to set your passwords

# 2. Start (pulls the prebuilt image — no build step needed)
docker compose up -d

# 3. Connect
ssh -p 2222 claude@localhost    # password is CLAUDE_USER_PASSWORD from .env
# — or open http://localhost:7681 in a browser (TTYD_USERNAME / TTYD_PASSWORD)

# 4. Authenticate Claude Code (first time only)
claude                          # follow the login link that appears
```

> **No Sysbox?** The default `docker-compose.yml` sets `runtime: sysbox-runc` for Docker-in-Docker. If you don't have [Sysbox](https://github.com/nestybox/sysbox) installed, create a one-line override to use the default runtime:
>
> ```bash
> echo 'services: { claude-box: { runtime: runc } }' > docker-compose.override.yml
> docker compose up -d
> ```
>
> Everything except `docker` commands inside the container will work without Sysbox.

## What's Included

The container comes pre-installed with:

| Category | Software | Purpose |
|----------|----------|---------|
| **AI** | Claude Code | Anthropic's CLI agent |
| **Runtimes** | Node.js 20 LTS | MCP servers (npx) |
| | Python 3 + venv | MCP servers (uvx) |
| | .NET SDK 8.0, 9.0, 10.0 | Side-by-side; selected via `global.json` |
| **Package managers** | npm | Node packages (global prefix persisted) |
| | uv / uvx | Python packages and tool runner |
| **Containers** | Docker Engine + Compose | Docker-in-Docker (requires Sysbox on host) |
| **Access** | OpenSSH server | Remote access (port 2222) |
| | ttyd | Web terminal (port 7681) |
| | mosh | Resilient mobile shell (UDP 60000-60003) |
| **Dev tools** | git | Version control |
| | GitHub CLI (gh) | GitHub operations |
| | curl, jq | HTTP requests and JSON processing |
| **System** | s6-overlay v3 | Process supervision |
| | sudo (passwordless) | Root access for `claude` user |

## Access Methods

### SSH (port 2222)

```bash
ssh -p 2222 claude@localhost
```

Use your `CLAUDE_USER_PASSWORD` to authenticate, or add your public key to the container:

```bash
ssh-copy-id -p 2222 claude@localhost
```

### Web Terminal (port 7681)

Open `http://localhost:7681` in your browser. Authenticate with `TTYD_USERNAME` / `TTYD_PASSWORD` from your `.env`.

### Direct Shell

```bash
make shell
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CLAUDE_USER_PASSWORD` | SSH password for `claude` user | `changeme` |
| `TTYD_USERNAME` | Web terminal username | `claude` |
| `TTYD_PASSWORD` | Web terminal password | `changeme` |

## Authentication

Claude Box uses the interactive login flow. After starting the container, run `claude` and follow the login link to authenticate with your Claude account. Credentials are stored in `~/.claude/` which is backed by the `claude-config` Docker volume, so they persist across container restarts.

## MCP Server Configuration

MCP servers configured inside the container persist across restarts via the `claude-config` volume:

```bash
# SSH in and add an MCP server
ssh -p 2222 claude@localhost
claude mcp add my-server -- npx some-mcp-server
```

The configuration is stored in `~/.claude/` which is backed by a Docker volume.

## Volumes

| Volume | Container Path | Purpose |
|--------|---------------|---------|
| `claude-config` | `/home/claude/.claude` | Claude settings, MCP config |
| `workspace` | `/home/claude/workspace` | Project files |
| `docker-data` | `/var/lib/docker` | Docker images, containers, layers |

## Make Targets

| Target | Description |
|--------|-------------|
| `make build` | Build the Docker image |
| `make up` | Start the container |
| `make down` | Stop the container |
| `make logs` | Follow container logs |
| `make shell` | Open a shell in the container |
| `make ssh` | SSH into the container |
| `make clean` | Stop container, remove volumes and image |
| `make docker-test` | Run hello-world inside the container (DinD smoke test) |

## Security Notes

- Change all default passwords in `.env` before exposing to a network
- The `.env` file is excluded from git via `.gitignore`
- SSH root login is disabled
- For remote access, use SSH tunneling or put behind a reverse proxy with TLS
- The `claude` user has passwordless sudo inside the container

## Backup and Restore

```bash
# Backup Claude config
docker run --rm -v claude-box_claude-config:/data -v $(pwd):/backup alpine \
    tar czf /backup/claude-config-backup.tar.gz -C /data .

# Restore
docker run --rm -v claude-box_claude-config:/data -v $(pwd):/backup alpine \
    tar xzf /backup/claude-config-backup.tar.gz -C /data
```

## Docker-in-Docker

Claude Box includes Docker Engine inside the container. With [Sysbox](https://github.com/nestybox/sysbox) installed on the host, agents can build and run Docker containers securely without `--privileged`.

**Prerequisites:** Sysbox must be installed on the Docker host. See the [Sysbox installation guide](https://github.com/nestybox/sysbox/blob/master/docs/user-guide/install-package.md).

```bash
# Verify DinD works
make docker-test

# Use Docker inside the container
make shell
docker run --rm alpine echo "Hello from nested container"
docker build -t myapp .
```

The `docker-data` volume persists pulled images and build cache across container restarts.

## Architecture

```
┌──────────────────────────────────────────┐
│     claude-box container (sysbox-runc)   │
│                                          │
│  ┌─────────┐  ┌──────────┐  ┌────────┐  │
│  │  sshd   │  │   ttyd   │  │dockerd │  │
│  │ :2222   │  │  :7681   │  │  DinD  │  │
│  └────┬────┘  └────┬─────┘  └────┬───┘  │
│       └──────┬──────┘─────────────┘      │
│           Claude Code CLI                │
│       Node.js 20 · Python 3 (MCP)       │
│                                          │
│  Volumes:                                │
│   ~/.claude/     → claude-config vol     │
│   ~/workspace/   → workspace vol         │
│   /var/lib/docker → docker-data vol      │
└──────────────────────────────────────────┘
```

Process supervision by [s6-overlay](https://github.com/just-containers/s6-overlay). Web terminal by [ttyd](https://github.com/tsl0922/ttyd).

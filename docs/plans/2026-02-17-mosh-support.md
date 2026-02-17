# Mosh Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add mosh (Mobile Shell) to claude-box for resilient remote access over unreliable networks.

**Architecture:** Install mosh server in the container image, expose a small UDP port range (60000-60003), and document usage. Mosh authenticates via the existing SSH daemon on port 2222, then spawns mosh-server per-connection — no new s6 service needed.

**Tech Stack:** Debian `mosh` package, Docker UDP port mapping

---

### Task 1: Add mosh to the Dockerfile

**Files:**
- Modify: `Dockerfile:9-18` (base packages install)
- Modify: `Dockerfile:94` (EXPOSE line)

**Step 1: Add `mosh` to the apt-get install list**

In the base packages `RUN` block, add `mosh` after `jq`:

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends \
        openssh-server \
        mosh \
        git \
        curl \
        ca-certificates \
        sudo \
        xz-utils \
        bash \
        jq \
    && rm -rf /var/lib/apt/lists/*
```

**Step 2: Add UDP port exposure**

Change the existing `EXPOSE` line from:

```dockerfile
EXPOSE 2222 7681
```

to:

```dockerfile
EXPOSE 2222 7681 60000-60003/udp
```

**Step 3: Commit**

```bash
git add Dockerfile
git commit -m "feat: add mosh server to container image"
```

---

### Task 2: Expose UDP ports in docker-compose.yml

**Files:**
- Modify: `docker-compose.yml:7-9` (ports section)

**Step 1: Add UDP port range to ports mapping**

Add the mosh UDP port range after the existing TCP ports:

```yaml
    ports:
      - "2222:2222"
      - "7681:7681"
      - "60000-60003:60000-60003/udp"
```

**Step 2: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: expose mosh UDP ports in docker-compose"
```

---

### Task 3: Add `make mosh` target

**Files:**
- Modify: `Makefile:1` (.PHONY line)
- Modify: `Makefile` (add new target after `ssh` target)

**Step 1: Add `mosh` to .PHONY and add the target**

Update the `.PHONY` line:

```makefile
.PHONY: build up down logs shell ssh mosh clean docker-test
```

Add the `mosh` target after the `ssh` target (after line 20):

```makefile
mosh:
	mosh --ssh='ssh -p 2222' claude@localhost
```

**Step 2: Commit**

```bash
git add Makefile
git commit -m "feat: add make mosh convenience target"
```

---

### Task 4: Update CLAUDE.md documentation

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update Architecture Overview — Networking section**

Find the networking section (around line mentioning "two exposed ports") and update to three exposed ports:

```markdown
3. **Networking** — three exposed ports:
   - `2222` — SSH access (`ssh -p 2222 claude@<host>`)
   - `7681` — ttyd web terminal (`http://<host>:7681`)
   - `60000-60003/udp` — mosh (Mobile Shell) for resilient remote access
```

**Step 2: Update Common Commands section**

Add mosh access after the existing SSH line:

```markdown
make mosh   # Connect via mosh (resilient mobile shell, port 2222 + UDP 60000-60003)
```

**Step 3: Update Manual verification section**

Add a mosh verification step after the SSH access step (step 3):

```markdown
4. **Mosh access** — `make mosh` (or `mosh --ssh='ssh -p 2222' claude@localhost`) should connect and drop into a bash shell. Verify the session survives a brief network interruption (e.g., sleep/wake laptop).
```

Renumber subsequent steps (4→5, 5→6, etc.).

**Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add mosh support to project documentation"
```

---

### Task 5: Build and verify

**Step 1: Build the image**

```bash
docker build -t claude-box:latest .
```

Expected: Build succeeds, mosh package is installed.

**Step 2: Verify mosh-server is in the image**

```bash
docker run --rm claude-box:latest which mosh-server
```

Expected: `/usr/bin/mosh-server`

**Step 3: Commit the design doc**

```bash
git add docs/plans/
git commit -m "docs: add mosh support design and implementation plan"
```

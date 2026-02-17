# Mosh Support for Claude Box

## Summary

Add mosh (Mobile Shell) support to claude-box for resilient remote access over unreliable networks. Mosh uses SSH for initial authentication then switches to a UDP-based protocol that handles roaming, intermittent connectivity, and local echo.

## Approach: Install-only

Mosh's server (`mosh-server`) is spawned on-demand by the SSH handshake — no persistent daemon or s6 service needed. We install the package, expose a small UDP port range, and document usage.

## Changes

### Dockerfile
- Add `mosh` to the base `apt-get install` step
- Add `EXPOSE 60000-60003/udp` alongside existing TCP port exposures

### docker-compose.yml
- Map UDP ports `60000-60003:60000-60003/udp`

### Makefile
- Add `make mosh` target: `mosh --ssh='ssh -p 2222' claude@localhost`

### CLAUDE.md
- Document mosh in Architecture Overview (networking section)
- Add `make mosh` to Common Commands
- Add mosh verification to Manual verification section

## Design Decisions

- **Small UDP range (60000-60003):** Supports 1-2 concurrent sessions, matching claude-box's single-user design. Minimizes exposed ports.
- **No s6 service:** Mosh-server is not a daemon; it's spawned per-connection by SSH. Adding an s6 service would fight the tool's design.
- **Reuses existing SSH on port 2222:** No changes to sshd configuration needed. Users specify the port via `mosh --ssh='ssh -p 2222'`.

## Testing

Manual verification only — mosh requires a real UDP connection which isn't suitable for Playwright tests. Verify by running `make mosh` after `make up`.

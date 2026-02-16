#!/bin/bash
set -e

# Generate SSH host keys if missing
if [ ! -f /etc/ssh/ssh_host_rsa_key ]; then
    ssh-keygen -A
fi

# Set claude user password from env
if [ -n "$CLAUDE_USER_PASSWORD" ]; then
    echo "claude:${CLAUDE_USER_PASSWORD}" | chpasswd
fi

# Ensure SSH run directory exists
mkdir -p /run/sshd

# Ensure authorized_keys directory exists on the volume
mkdir -p /home/claude/.claude/ssh
touch /home/claude/.claude/ssh/authorized_keys
chmod 700 /home/claude/.claude/ssh
chmod 600 /home/claude/.claude/ssh/authorized_keys

# Persist ~/.claude.json via symlink into the mounted volume
if [ ! -L /home/claude/.claude.json ]; then
    # Migrate existing file into the volume if present
    if [ -f /home/claude/.claude.json ]; then
        mv /home/claude/.claude.json /home/claude/.claude/claude.json
    fi
    ln -sf /home/claude/.claude/claude.json /home/claude/.claude.json
fi

# Ensure Docker runtime directories exist
mkdir -p /var/run/docker

# Fix ownership on mounted volumes
chown -R claude:claude /home/claude/.claude
chown -R claude:claude /home/claude/workspace

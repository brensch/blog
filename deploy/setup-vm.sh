#!/bin/sh
# One-time (idempotent) setup of the schlift.com VM for the blog; `make setup-vm`
# runs it there as root after copying blog.caddyfile to /tmp. `make deploy` then
# fills /opt/blog/site.
set -eu
install -d -m 755 /opt/blog
install -d -o opc -g opc -m 755 /opt/blog/site
install -d -m 755 /etc/caddy/Caddyfile.d
install -m 644 /tmp/blog.caddyfile /etc/caddy/Caddyfile.d/blog.caddyfile
rm -f /tmp/blog.caddyfile
out=$(caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1) || { echo "$out"; exit 1; }
systemctl reload caddy
echo "blog set up; run make deploy"

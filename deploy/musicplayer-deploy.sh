#!/usr/bin/env bash
#
# /usr/local/sbin/musicplayer-deploy
#
# The one thing GitHub's deploy key may do on this server. Its line in
# /root/.ssh/authorized_keys is
#
#   restrict,command="/usr/local/sbin/musicplayer-deploy" ssh-ed25519 … musicplayer-github-deploy
#
# so whatever that key asks to run, this runs instead: it starts the deploy,
# waits for it, prints the deploy's log for the workflow run to show, and exits
# as the deploy did.
#
set -uo pipefail

# The journal is read from this second on. The workflow's concurrency group
# keeps two deploys from starting within the same one.
since=$(date +%s)
systemctl start musicplayer-deploy.service
result=$?
journalctl --unit musicplayer-deploy.service --since "@$since" --output cat --no-pager
exit "$result"

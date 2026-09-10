#!/usr/bin/env bash
#
# Put a published image on the box and prove it took (US-075).
#
#   scripts/deploy-remote.sh <host> <directory> <project> [image] [overlay]
#
# `image` is a digest reference — repository@sha256:… — and giving one is what
# separates a deploy from a hope. A tag is a mutable pointer: `pull` can be a
# no-op against a stale local copy, `up -d` can decide nothing changed, and both
# report success. A digest cannot mean two things, so the box is told exactly
# which build to run and then asked which one it is running.
#
# Run by .github/workflows/deploy-staging.yml. It is a script rather than
# twenty lines of YAML so the same steps can be run by hand from a laptop when
# the workflow is the thing that is broken.
#
# The compose files travel with the image, and that is the point of the script.
# Compose reads its YAML from the box, so a deploy that moves only the image
# boots a new build against an old file — and that failure is silent. On
# 2026-09-08 the box ran a new image against a compose file from before US-074:
# `BILLING_MODE=stripe` sat in `.env`, the container never received it, the
# instance served every screen correctly and charged nobody.
#
# `.env` is NOT copied. It holds the box's own secrets, it is not in this
# repository, and a deploy that overwrote it would replace a generated
# Postgres password with whatever a developer had locally.
#
# `overlay` is an extra compose file for one stack alone (US-105). Staging
# passes `docker-compose.staging.yml`, which puts a password in front of the
# site; production passes none, so it never receives the prompt. The caller
# names the file rather than the script guessing it, because the two workflows
# are twins that each know one answer.

set -euo pipefail

host=${1:?the box to deploy to}
directory=${2:?the directory for this stack on the box}
project=${3:?the compose project name}
image=${4:-}
overlay=${5:-}

ssh_options=(-o BatchMode=yes -o ConnectTimeout=15)
remote="root@${host}"

files=(docker-compose.yml docker-compose.prod.yml docker-compose.proxy.yml)
compose=(docker compose -p "$project" -f docker-compose.yml -f docker-compose.prod.yml)
if [ -n "$overlay" ]; then
  files+=("$overlay")
  compose+=(-f "$overlay")
fi

# Passed through the ssh command line rather than written into the box's `.env`,
# because the two answer different questions: `.env` says which stream this box
# follows, and this says which build this deploy is placing. A shell variable
# beats `.env` during interpolation, so the pin holds for exactly this command
# and the file is left alone.
image_setting=""
if [ -n "$image" ]; then
  image_setting="SIGNALSCOUT_IMAGE='${image}' "
fi

echo "==> Sending the compose files from this commit"
ssh "${ssh_options[@]}" "$remote" "mkdir -p '$directory'"
scp "${ssh_options[@]}" -q \
  "${files[@]}" \
  "${remote}:${directory}/"

echo "==> Pulling and starting"
ssh "${ssh_options[@]}" "$remote" \
  "cd '$directory' && ${image_setting}${compose[*]} pull -q && ${image_setting}${compose[*]} up -d --remove-orphans"

echo "==> Waiting for the app to report healthy"
ssh "${ssh_options[@]}" "$remote" "
  for _ in \$(seq 1 30); do
    state=\$(docker inspect -f '{{.State.Health.Status}}' '${project}-app-1' 2>/dev/null || echo missing)
    [ \"\$state\" = healthy ] && exit 0
    sleep 2
  done
  echo \"the app never became healthy; last state: \$state\" >&2
  docker logs --tail 40 '${project}-app-1' >&2 || true
  exit 1
"

# Ask the box what it is actually running. Deploying by digest makes the
# container image id the digest itself, so this is a direct comparison and not
# an inference from a tag that may have moved under either side.
if [ -n "$image" ]; then
  expected=${image##*@}
  echo "==> Checking the box is serving ${expected}"

  running=$(ssh "${ssh_options[@]}" "$remote" \
    "docker inspect -f '{{.Image}}' '${project}-app-1'")

  if [ "$running" != "$expected" ]; then
    echo "the box is serving ${running}, not ${expected}" >&2
    exit 1
  fi

  echo "==> ${project} is serving the build this run produced"
else
  echo "==> No image given, so nothing was asserted about which build is serving"
fi

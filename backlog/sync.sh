#!/usr/bin/env bash
# Mirror the ticket files to GitHub Issues.
#
#   backlog/sync.sh             open, update and close issues to match the files
#   backlog/sync.sh --dry-run   print what it would do, change nothing
#   backlog/sync.sh --check     exit 1 if the mirror is out of date
#
# The files are the source. An issue is a view of one, and nothing flows back:
# a comment on an issue is for people, and this script never reads one. The
# reasoning for mirroring rather than moving is in US-299.
#
# What it does, per ticket in todo/ and doing/: open an issue titled
# `US-123: <title>` whose body is the ticket's Context and a link to the file,
# labelled `ticket` plus whatever the ticket's `labels:` names, and write the
# number back into the ticket's frontmatter as `issue:`. A ticket that reaches
# done/ or parked/ has its issue closed on the next run.
#
# Needs `gh`, authenticated, with write access to the repository.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${SIGNALSCOUT_REPO:-rszhd/signalscout}"
# Labels this script owns. One the file stops naming is removed; anything
# else on the issue was put there by a person and stays.
MANAGED_LABELS="ticket,good first issue,help wanted,easy,medium"
BRANCH="${SIGNALSCOUT_BRANCH:-dev}"

mode=sync
case "${1:-}" in
  --dry-run) mode=dry ;;
  --check)   mode=check ;;
  "")        ;;
  *) echo "usage: sync.sh [--dry-run|--check]" >&2; exit 2 ;;
esac

# field <file> <key> — one frontmatter value, empty when absent.
field() {
  awk -v key="$2" '
    function trim(s) { gsub(/^[ \t]+|[ \t]+$/, "", s); return s }
    NR == 1 { fm = ($0 == "---"); next }
    !fm { exit }
    $0 == "---" { exit }
    {
      p = index($0, ":")
      if (p == 0) next
      k = trim(substr($0, 1, p - 1))
      if (k != key) next
      v = trim(substr($0, p + 1))
      sub(/[ \t]+#.*$/, "", v)
      if (v ~ /^".*"$/ || v ~ /^'"'"'.*'"'"'$/) v = substr(v, 2, length(v) - 2)
      print v
      exit
    }
  ' "$1"
}

# context <file> — the Context section, without its heading.
context() {
  awk '
    /^## Context$/ { inside = 1; next }
    /^## / { inside = 0 }
    inside { print }
  ' "$1" | sed -e '/./,$!d' | awk '{ lines[NR] = $0 } END { last = NR; while (last > 0 && lines[last] ~ /^[ \t]*$/) last--; for (i = 1; i <= last; i++) print lines[i] }'
}

body() {
  local file="$1" rel="${1#"$ROOT/"}"
  context "$file"
  printf '\n\n---\n\nThe ticket is [`backlog/%s`](https://github.com/%s/blob/%s/backlog/%s), and it is the source: its **Acceptance** list is what "done" means, and its **Log** says what happened. This issue is generated from it by `backlog/sync.sh` and closes when the file reaches `done/`.\n' \
    "$rel" "$REPO" "$BRANCH" "$rel"
}

# set_field <file> <key> <value> — add or replace one frontmatter line.
set_field() {
  local file="$1" key="$2" value="$3"
  if grep -qE "^${key}:" "$file"; then
    sed -i -E "0,/^${key}:.*/s##${key}: ${value}#" "$file"
  else
    sed -i -E "0,/^id:.*/s##&\n${key}: ${value}#" "$file"
  fi
}

# want_labels <frontmatter value> — one label per line, `ticket` first.
#
# The trailing newline matters: `read` returns false on a last line without
# one, so a loop over this silently drops the final label.
want_labels() {
  printf 'ticket\n'
  printf '%s\n' "${1//[\[\]]/}" | tr ',' '\n' | sed -e 's/^[ \t"'"'"']*//' -e 's/[ \t"'"'"']*$//' -e '/^$/d'
}

say() { printf '%s\n' "$*"; }

stale=0
declare -a created=()

while IFS= read -r -d '' file; do
  rel="${file#"$ROOT/"}"
  status="${rel%%/*}"
  id="$(field "$file" id)"
  title="$(field "$file" title)"
  issue="$(field "$file" issue)"
  labels="$(field "$file" labels)"
  resolution="$(field "$file" resolution)"
  [ -n "$id" ] && [ -n "$title" ] || { echo "sync: $rel has no id or no title" >&2; exit 1; }
  want="$id: $title"

  case "$status" in
    todo|doing)
      if [ -z "$issue" ]; then
        stale=1
        case "$mode" in
          check) say "no issue: $rel" ;;
          dry)   say "would open: $want" ;;
          sync)
            args=(--repo "$REPO" --title "$want" --body-file - --label ticket)
            while IFS= read -r l; do args+=(--label "$l"); done < <(want_labels "$labels")
            url="$(body "$file" | gh issue create "${args[@]}")"
            number="${url##*/}"
            set_field "$file" issue "$number"
            created+=("#$number $want")
            say "opened #$number for $id"
            ;;
        esac
        continue
      fi
      have="$(gh issue view "$issue" --repo "$REPO" --json title,state,labels -q '.title + "\t" + .state + "\t" + ([.labels[].name] | sort | join(","))' 2>/dev/null || true)"
      if [ -z "$have" ]; then
        stale=1
        say "issue #$issue named by $rel does not exist"
        continue
      fi
      IFS=$'\t' read -r have_title have_state have_labels <<< "$have"
      want_label_list="$(want_labels "$labels" | sort | paste -sd, -)"
      if [ "$have_title" != "$want" ] || [ "$have_state" != "OPEN" ] || [ "$have_labels" != "$want_label_list" ]; then
        stale=1
        case "$mode" in
          check) say "out of date: #$issue for $rel" ;;
          dry)   say "would update #$issue: $want" ;;
          sync)
            edit=(--repo "$REPO" --title "$want" --body-file -)
            # Reconcile both ways, so a label dropped from the file leaves the
            # issue. Labels GitHub carries that the file never named — a
            # triage label somebody added by hand — are left alone.
            while IFS= read -r l; do
              [ -n "$l" ] && ! grep -qxF "$l" <(printf '%s' "$have_labels" | tr ',' '\n') && edit+=(--add-label "$l")
            done < <(want_labels "$labels")
            while IFS= read -r l; do
              case ",$MANAGED_LABELS," in *",$l,"*) ;; *) continue ;; esac
              grep -qxF "$l" <(want_labels "$labels") || edit+=(--remove-label "$l")
            done < <(printf '%s' "$have_labels" | tr ',' '\n')
            body "$file" | gh issue edit "$issue" "${edit[@]}" >/dev/null
            [ "$have_state" != "OPEN" ] && gh issue reopen "$issue" --repo "$REPO" >/dev/null
            say "updated #$issue for $id"
            ;;
        esac
      fi
      ;;

    parked|done)
      [ -n "$issue" ] || continue
      have_state="$(gh issue view "$issue" --repo "$REPO" --json state -q .state 2>/dev/null || true)"
      [ "$have_state" = "OPEN" ] || continue
      stale=1
      if [ "$status" = "done" ] && [ "$resolution" = "shipped" ]; then
        reason=completed
        note="Shipped. The ticket's Log says what happened."
      elif [ "$status" = "parked" ]; then
        reason="not planned"
        note="Parked: decided to wait, with no owner and no date. The ticket says why."
      else
        reason="not planned"
        note="Closed as ${resolution:-dropped}. The ticket's Log says why."
      fi
      case "$mode" in
        check) say "still open: #$issue for $rel" ;;
        dry)   say "would close #$issue as $reason" ;;
        sync)
          gh issue close "$issue" --repo "$REPO" --reason "$reason" --comment "$note" >/dev/null
          say "closed #$issue for $id"
          ;;
      esac
      ;;
  esac
done < <(find "$ROOT/todo" "$ROOT/doing" "$ROOT/parked" -maxdepth 1 -name '*.md' -print0 2>/dev/null | sort -z;
         find "$ROOT/done" -mindepth 2 -maxdepth 2 -name '*.md' -print0 2>/dev/null | sort -z)

if [ "$mode" = check ]; then
  [ "$stale" -eq 0 ] && { say "the mirror matches the ticket files"; exit 0; }
  say "run backlog/sync.sh to bring the mirror up to date"
  exit 1
fi

[ ${#created[@]} -gt 0 ] && say "opened ${#created[@]} issue(s); commit the ticket files so the numbers are recorded"
exit 0

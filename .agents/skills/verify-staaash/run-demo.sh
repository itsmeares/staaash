#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
DATA_ROOT="${XDG_DATA_HOME:-${HOME:?HOME is not set}/.local/share}/staaash-qa"

die() {
  printf 'verify-staaash: %s\n' "$*" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || die "missing command: $1"
}

run_file_for() {
  local run_file=$1
  [[ -f "$run_file" ]] || die "run file does not exist: $run_file"
  case "$run_file" in
    "$DATA_ROOT"/staaash-verify-*/run.env) ;;
    *) die "run file is outside the verification state root: $run_file" ;;
  esac
  printf '%s\n' "$run_file"
}

load_run() {
  local run_file=$1
  run_file_for "$run_file" >/dev/null
  set -a
  # This file is created by this helper and contains no shell input from the user.
  source "$run_file"
  set +a
  case "$STAAASH_VERIFY_PROJECT" in
    staaash-verify-*) ;;
    *) die "run file does not name an isolated verification project" ;;
  esac
  case "$STAAASH_VERIFY_IMAGE" in
    staaash-verify:*) ;;
    *) die "run file does not name an isolated verification image" ;;
  esac
  case "$STAAASH_VERIFY_BUILDER" in
    staaash-verify-builder-*) ;;
    *) die "run file does not name an isolated verification builder" ;;
  esac
  STATE_DIR="$(dirname -- "$run_file")"
  EVIDENCE_DIR="$STAAASH_VERIFY_EVIDENCE_DIR"
  COMPOSE_ARGS=(
    --project-name "$STAAASH_VERIFY_PROJECT"
    --env-file "$run_file"
    --file "$REPO_ROOT/docker-compose.yml"
    --file "$SCRIPT_DIR/compose.override.yml"
  )
}

compose() {
  docker compose "${COMPOSE_ARGS[@]}" "$@"
}

port_free() {
  local port=$1
  if ss -ltnH | awk -v port=":$port" '$4 ~ port "$" { found = 1 } END { exit found }'; then
    return 0
  fi
  return 1
}

pick_port() {
  local first=$1
  local last=$((first + 80))
  local port
  for port in $(seq "$first" "$last"); do
    if [[ "$port" != 2113 && "$port" != 5432 ]] && port_free "$port"; then
      printf '%s\n' "$port"
      return
    fi
  done
  die "no free port in $first-$last"
}

tailnet_ip() {
  local ip
  ip="$(tailscale ip -4 2>/dev/null | head -n 1 || true)"
  [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] ||
    die "tailscale did not return an IPv4 address"
  printf '%s\n' "$ip"
}

write_run_info() {
  mkdir -p -- "$EVIDENCE_DIR"
  cat >"$EVIDENCE_DIR/run-info.txt" <<EOF
project=$STAAASH_VERIFY_PROJECT
image=$STAAASH_VERIFY_IMAGE
builder=$STAAASH_VERIFY_BUILDER
web_port=$STAAASH_VERIFY_WEB_PORT
db_port=$STAAASH_VERIFY_DB_PORT
url=$STAAASH_VERIFY_URL
evidence=$EVIDENCE_DIR
created=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
}

capture_logs() {
  mkdir -p -- "$EVIDENCE_DIR"
  compose ps --all >"$EVIDENCE_DIR/compose-ps.txt" 2>&1 || true
  compose logs --no-color >"$EVIDENCE_DIR/compose.log" 2>&1 || true
}

remove_resources() {
  set +e
  capture_logs
  compose down --volumes --remove-orphans >"$EVIDENCE_DIR/cleanup.log" 2>&1
  docker image rm "$STAAASH_VERIFY_IMAGE" >>"$EVIDENCE_DIR/cleanup.log" 2>&1
  docker buildx rm "$STAAASH_VERIFY_BUILDER" >>"$EVIDENCE_DIR/cleanup.log" 2>&1
  set -e
}

remove_state() {
  case "$STATE_DIR" in
    "$DATA_ROOT"/staaash-verify-*) ;;
    *) die "refusing to remove an unexpected state directory: $STATE_DIR" ;;
  esac
  [[ "$STATE_DIR" != "$DATA_ROOT" ]] || die "refusing to remove the data root"
  rm -rf -- "$STATE_DIR"
}

cleanup_failed_launch() {
  local status=$?
  trap - ERR
  set +e
  remove_resources
  remove_state
  printf 'verify-staaash: launch failed; evidence is in %s\n' "$EVIDENCE_DIR" >&2
  exit "$status"
}

wait_for_app() {
  local attempt
  for attempt in $(seq 1 180); do
    if curl --silent --show-error --fail --max-time 4 \
      "$STAAASH_VERIFY_PROBE_URL/api/health/live" >"$EVIDENCE_DIR/health-live.json" 2>>"$EVIDENCE_DIR/health.log" &&
      curl --silent --show-error --fail --max-time 4 \
        "$STAAASH_VERIFY_PROBE_URL/" >"$EVIDENCE_DIR/health-home.html" 2>>"$EVIDENCE_DIR/health.log" &&
      grep -q "Bring your Staaash" "$EVIDENCE_DIR/health-home.html"; then
      return
    fi
    sleep 1
  done
  capture_logs
  die "the app did not become ready; see $EVIDENCE_DIR/compose.log"
}

launch() {
  need docker
  need tailscale
  need curl
  need ss
  need openssl
  mkdir -p -- "$DATA_ROOT"

  local run_id project state_dir evidence_dir web_port db_port ip image builder db_password auth_secret
  run_id="$(date -u +%Y%m%d%H%M%S)-$$"
  project="staaash-verify-$run_id"
  state_dir="$DATA_ROOT/$project"
  evidence_dir="$DATA_ROOT/evidence-$project"
  web_port="$(pick_port 3213)"
  db_port="$(pick_port 35432)"
  ip="$(tailnet_ip)"
  image="staaash-verify:$run_id"
  builder="staaash-verify-builder-$run_id"
  db_password="verifydb$(date +%s)$$"
  auth_secret="$(openssl rand -hex 24)"

  mkdir -p -- "$state_dir" "$evidence_dir"
  cat >"$state_dir/run.env" <<EOF
STAAASH_VERIFY_PROJECT=$project
STAAASH_VERIFY_IMAGE=$image
STAAASH_VERIFY_BUILDER=$builder
STAAASH_VERIFY_EVIDENCE_DIR=$evidence_dir
STAAASH_VERIFY_BIND_IP=0.0.0.0
STAAASH_VERIFY_TAILNET_IP=$ip
STAAASH_VERIFY_WEB_PORT=$web_port
STAAASH_VERIFY_DB_PORT=$db_port
STAAASH_VERIFY_URL=http://$ip:$web_port
STAAASH_VERIFY_PROBE_URL=http://127.0.0.1:$web_port
DB_USERNAME=postgres
DB_PASSWORD=$db_password
DB_DATABASE_NAME=staaash
AUTH_SECRET=$auth_secret
UPLOAD_LOCATION=/data/files
SECURE_COOKIES=false
EOF

  load_run "$state_dir/run.env"
  write_run_info
  trap cleanup_failed_launch ERR

  docker buildx create --name "$STAAASH_VERIFY_BUILDER" --driver docker-container \
    >"$EVIDENCE_DIR/builder-create.log" 2>&1
  docker buildx build \
    --builder "$STAAASH_VERIFY_BUILDER" \
    --load \
    --tag "$STAAASH_VERIFY_IMAGE" \
    "$REPO_ROOT" >"$EVIDENCE_DIR/build.log" 2>&1
  compose up --detach db staaash worker >"$EVIDENCE_DIR/compose-up.log" 2>&1
  wait_for_app

  trap - ERR
  printf 'verify-staaash: project=%s\n' "$STAAASH_VERIFY_PROJECT" >&2
  printf 'verify-staaash: open %s from another device\n' "$STAAASH_VERIFY_URL" >&2
  printf 'verify-staaash: evidence=%s\n' "$EVIDENCE_DIR" >&2
  printf '%s/run.env\n' "$STATE_DIR"
}

doctor() {
  need docker
  need curl
  local run_file=$1
  load_run "$run_file"
  mkdir -p -- "$EVIDENCE_DIR"

  compose ps --all | tee "$EVIDENCE_DIR/doctor-compose.txt" >&2
  local service expected_name actual_name
  for service in db staaash worker; do
    expected_name="${STAAASH_VERIFY_PROJECT}_$([[ "$service" == staaash ]] && printf web || printf '%s' "$service")"
    actual_name="$(docker inspect --format '{{.Name}} {{.Config.Image}} {{.State.Status}} {{index .Config.Labels "com.docker.compose.project"}}' "$expected_name" 2>/dev/null || true)"
    [[ "$actual_name" == "/$expected_name $STAAASH_VERIFY_IMAGE running $STAAASH_VERIFY_PROJECT" ||
      ("$service" == db && "$actual_name" == "/$expected_name postgres:18-alpine running $STAAASH_VERIFY_PROJECT") ]] ||
      die "doctor found the wrong container for $service: $actual_name"
  done

  docker port "${STAAASH_VERIFY_PROJECT}_web" | grep -F "0.0.0.0:$STAAASH_VERIFY_WEB_PORT" \
    >"$EVIDENCE_DIR/doctor-web-port.txt"
  docker port "${STAAASH_VERIFY_PROJECT}_db" | grep -F "127.0.0.1:$STAAASH_VERIFY_DB_PORT" \
    >"$EVIDENCE_DIR/doctor-db-port.txt"
  curl --silent --show-error --fail --max-time 5 \
    "$STAAASH_VERIFY_PROBE_URL/api/health/live" >"$EVIDENCE_DIR/doctor-live.json"
  local ready_code
  ready_code="$(curl --silent --show-error --max-time 5 \
    --output "$EVIDENCE_DIR/doctor-ready.json" \
    --write-out '%{http_code}' "$STAAASH_VERIFY_PROBE_URL/api/health/ready" || true)"

  if [[ -f "$STATE_DIR/auth-cookie.txt" ]]; then
    [[ "$ready_code" == 200 ]] || die "doctor found an authenticated run that is not ready (HTTP $ready_code)"
    curl --silent --show-error --fail --max-time 5 \
      -H "Cookie: $(<"$STATE_DIR/auth-cookie.txt")" \
      "$STAAASH_VERIFY_PROBE_URL/api/auth/session" >"$EVIDENCE_DIR/doctor-auth.json"
  else
    [[ "$ready_code" == 200 || "$ready_code" == 503 ]] ||
      die "doctor found an unusable first-run instance (HTTP $ready_code)"
    curl --silent --show-error --fail --max-time 5 \
      "$STAAASH_VERIFY_PROBE_URL/" >"$EVIDENCE_DIR/doctor-first-run.html"
    grep -q "Bring your Staaash" "$EVIDENCE_DIR/doctor-first-run.html" ||
      die "doctor could not find the first-run page"
  fi
  printf 'verify-staaash: doctor passed for %s\n' "$STAAASH_VERIFY_PROJECT"
}

drive() {
  need node
  local run_file=$1
  load_run "$run_file"
  node "$SCRIPT_DIR/drive-folder.mjs" "$run_file"
}

cleanup() {
  need docker
  local run_file=$1
  load_run "$run_file"
  printf 'verify-staaash: preserving evidence in %s\n' "$EVIDENCE_DIR" >&2
  remove_resources
  remove_state
  printf 'verify-staaash: cleanup passed; evidence remains in %s\n' "$EVIDENCE_DIR"
}

case "${1:-}" in
  launch)
    launch
    ;;
  doctor)
    [[ $# -eq 2 ]] || die "usage: $0 doctor RUN_ENV"
    doctor "$2"
    ;;
  drive)
    [[ $# -eq 2 ]] || die "usage: $0 drive RUN_ENV"
    drive "$2"
    ;;
  cleanup)
    [[ $# -eq 2 ]] || die "usage: $0 cleanup RUN_ENV"
    cleanup "$2"
    ;;
  *)
    die "usage: $0 launch | doctor RUN_ENV | drive RUN_ENV | cleanup RUN_ENV"
    ;;
esac

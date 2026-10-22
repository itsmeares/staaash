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
  case "${STAAASH_VERIFY_SHARE:-}" in
    localhost|tailnet) ;;
    *) die "run file has an invalid STAAASH_VERIFY_SHARE: $STAAASH_VERIFY_SHARE" ;;
  esac
  [[ -f "$STATE_DIR/compose.network.yml" ]] ||
    die "run file is missing its compose network override"
  EVIDENCE_DIR="$STAAASH_VERIFY_EVIDENCE_DIR"
  COMPOSE_ARGS=(
    --project-name "$STAAASH_VERIFY_PROJECT"
    --env-file "$run_file"
    --file "$REPO_ROOT/docker-compose.yml"
    --file "$SCRIPT_DIR/compose.override.yml"
    --file "$STATE_DIR/compose.network.yml"
  )
}

compose() {
  docker compose "${COMPOSE_ARGS[@]}" "$@"
}

tailnet_ip() {
  local ip
  ip="$(tailscale ip -4 2>/dev/null | head -n 1 || true)"
  [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] ||
    die "tailscale did not return an IPv4 address"
  printf '%s\n' "$ip"
}

set_resource_defaults() {
  STAAASH_VERIFY_WEB_CPUS="${STAAASH_VERIFY_WEB_CPUS:-1.0}"
  STAAASH_VERIFY_WEB_MEMORY="${STAAASH_VERIFY_WEB_MEMORY:-1g}"
  STAAASH_VERIFY_WORKER_CPUS="${STAAASH_VERIFY_WORKER_CPUS:-0.5}"
  STAAASH_VERIFY_WORKER_MEMORY="${STAAASH_VERIFY_WORKER_MEMORY:-512m}"
  STAAASH_VERIFY_DB_CPUS="${STAAASH_VERIFY_DB_CPUS:-0.5}"
  STAAASH_VERIFY_DB_MEMORY="${STAAASH_VERIFY_DB_MEMORY:-512m}"
}

docker_host_port() {
  local container=$1
  local host=$2
  local container_port=$3
  local binding target
  while IFS= read -r binding; do
    target="${binding#*-> }"
    [[ "$target" != "$binding" ]] || target="$binding"
    if [[ "$target" == "$host:"* ]]; then
      printf '%s\n' "${target##*:}"
      return
    fi
  done < <(docker port "$container" "$container_port/tcp")
  die "docker did not publish $container_port/tcp on $host for $container"
}

write_compose_network() {
  local tailnet_binding=''
  if [[ "$STAAASH_VERIFY_SHARE" == tailnet ]]; then
    tailnet_binding="      - \"$STAAASH_VERIFY_TAILNET_IP::2113\""
  fi
  cat >"$STATE_DIR/compose.network.yml" <<EOF
services:
  staaash:
    ports: !override
      - "127.0.0.1::2113"
$tailnet_binding
  db:
    ports: !override
      - "127.0.0.1::5432"
EOF
}

write_run_env() {
  cat >"$STATE_DIR/run.env" <<EOF
STAAASH_VERIFY_PROJECT=$STAAASH_VERIFY_PROJECT
STAAASH_VERIFY_IMAGE=$STAAASH_VERIFY_IMAGE
STAAASH_VERIFY_BUILDER=$STAAASH_VERIFY_BUILDER
STAAASH_VERIFY_EVIDENCE_DIR=$STAAASH_VERIFY_EVIDENCE_DIR
STAAASH_VERIFY_SHARE=$STAAASH_VERIFY_SHARE
STAAASH_VERIFY_TAILNET_IP=$STAAASH_VERIFY_TAILNET_IP
STAAASH_VERIFY_WEB_PORT=$STAAASH_VERIFY_WEB_PORT
STAAASH_VERIFY_TAILNET_PORT=$STAAASH_VERIFY_TAILNET_PORT
STAAASH_VERIFY_DB_PORT=$STAAASH_VERIFY_DB_PORT
STAAASH_VERIFY_URL=$STAAASH_VERIFY_URL
STAAASH_VERIFY_LOOPBACK_URL=$STAAASH_VERIFY_LOOPBACK_URL
STAAASH_VERIFY_TAILNET_URL=$STAAASH_VERIFY_TAILNET_URL
STAAASH_VERIFY_PROBE_URL=$STAAASH_VERIFY_PROBE_URL
STAAASH_VERIFY_READY_ATTEMPTS=$STAAASH_VERIFY_READY_ATTEMPTS
STAAASH_VERIFY_WEB_CPUS=$STAAASH_VERIFY_WEB_CPUS
STAAASH_VERIFY_WEB_MEMORY=$STAAASH_VERIFY_WEB_MEMORY
STAAASH_VERIFY_WORKER_CPUS=$STAAASH_VERIFY_WORKER_CPUS
STAAASH_VERIFY_WORKER_MEMORY=$STAAASH_VERIFY_WORKER_MEMORY
STAAASH_VERIFY_DB_CPUS=$STAAASH_VERIFY_DB_CPUS
STAAASH_VERIFY_DB_MEMORY=$STAAASH_VERIFY_DB_MEMORY
DB_USERNAME=postgres
DB_PASSWORD=$STAAASH_VERIFY_DB_PASSWORD
DB_DATABASE_NAME=staaash
AUTH_SECRET=$STAAASH_VERIFY_AUTH_SECRET
UPLOAD_LOCATION=/data/files
SECURE_COOKIES=false
EOF
}

read_published_ports() {
  local web_container="${STAAASH_VERIFY_PROJECT}_web"
  local db_container="${STAAASH_VERIFY_PROJECT}_db"
  STAAASH_VERIFY_WEB_PORT="$(docker_host_port "$web_container" 127.0.0.1 2113)"
  STAAASH_VERIFY_DB_PORT="$(docker_host_port "$db_container" 127.0.0.1 5432)"
  STAAASH_VERIFY_LOOPBACK_URL="http://127.0.0.1:$STAAASH_VERIFY_WEB_PORT"
  STAAASH_VERIFY_TAILNET_PORT=''
  STAAASH_VERIFY_TAILNET_URL=''
  if [[ "$STAAASH_VERIFY_SHARE" == tailnet ]]; then
    STAAASH_VERIFY_TAILNET_PORT="$(docker_host_port "$web_container" "$STAAASH_VERIFY_TAILNET_IP" 2113)"
    STAAASH_VERIFY_TAILNET_URL="http://$STAAASH_VERIFY_TAILNET_IP:$STAAASH_VERIFY_TAILNET_PORT"
    STAAASH_VERIFY_URL="$STAAASH_VERIFY_TAILNET_URL"
  else
    STAAASH_VERIFY_URL="$STAAASH_VERIFY_LOOPBACK_URL"
  fi
  STAAASH_VERIFY_PROBE_URL="$STAAASH_VERIFY_LOOPBACK_URL"
}

write_run_info() {
  mkdir -p -- "$EVIDENCE_DIR"
  cat >"$EVIDENCE_DIR/run-info.txt" <<EOF
project=$STAAASH_VERIFY_PROJECT
image=$STAAASH_VERIFY_IMAGE
builder=$STAAASH_VERIFY_BUILDER
share=$STAAASH_VERIFY_SHARE
web_port=$STAAASH_VERIFY_WEB_PORT
tailnet_port=$STAAASH_VERIFY_TAILNET_PORT
db_port=$STAAASH_VERIFY_DB_PORT
url=$STAAASH_VERIFY_URL
loopback_url=$STAAASH_VERIFY_LOOPBACK_URL
tailnet_url=$STAAASH_VERIFY_TAILNET_URL
tailnet_ip=$STAAASH_VERIFY_TAILNET_IP
probe_url=$STAAASH_VERIFY_PROBE_URL
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
  local failed=0
  capture_logs
  if ! compose down --volumes --remove-orphans >"$EVIDENCE_DIR/cleanup.log" 2>&1; then
    failed=1
  fi
  if docker image inspect "$STAAASH_VERIFY_IMAGE" >/dev/null 2>&1; then
    if ! docker image rm "$STAAASH_VERIFY_IMAGE" >>"$EVIDENCE_DIR/cleanup.log" 2>&1; then
      failed=1
    fi
  fi
  if docker buildx inspect "$STAAASH_VERIFY_BUILDER" >/dev/null 2>&1; then
    if ! docker buildx rm "$STAAASH_VERIFY_BUILDER" >>"$EVIDENCE_DIR/cleanup.log" 2>&1; then
      failed=1
    fi
  fi
  return "$failed"
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
  trap - EXIT INT TERM
  if remove_resources && remove_state; then
    printf 'verify-staaash: launch failed; evidence is in %s\n' "$EVIDENCE_DIR" >&2
  else
    printf 'verify-staaash: launch failed; cleanup failed; run.env kept; evidence is in %s\n' "$EVIDENCE_DIR" >&2
  fi
  exit "$status"
}

wait_for_app() {
  local attempt max_attempts
  max_attempts="${STAAASH_VERIFY_READY_ATTEMPTS:-180}"
  for attempt in $(seq 1 "$max_attempts"); do
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
  need curl
  need openssl
  local share="${STAAASH_VERIFY_SHARE:-localhost}"
  case "$share" in
    localhost) ;;
    tailnet) need tailscale ;;
    *) die "STAAASH_VERIFY_SHARE must be localhost or tailnet" ;;
  esac
  mkdir -p -- "$DATA_ROOT"

  local run_id db_password auth_secret ready_attempts
  run_id="$(date -u +%Y%m%d%H%M%S)-$$"
  STAAASH_VERIFY_PROJECT="staaash-verify-$run_id"
  STATE_DIR="$DATA_ROOT/$STAAASH_VERIFY_PROJECT"
  STAAASH_VERIFY_EVIDENCE_DIR="$DATA_ROOT/evidence-$STAAASH_VERIFY_PROJECT"
  STAAASH_VERIFY_IMAGE="staaash-verify:$run_id"
  STAAASH_VERIFY_BUILDER="staaash-verify-builder-$run_id"
  STAAASH_VERIFY_SHARE="$share"
  STAAASH_VERIFY_TAILNET_IP=''
  if [[ "$STAAASH_VERIFY_SHARE" == tailnet ]]; then
    STAAASH_VERIFY_TAILNET_IP="$(tailnet_ip)"
  fi
  db_password="verifydb$(date +%s)$$"
  auth_secret="$(openssl rand -hex 24)"
  ready_attempts="${STAAASH_VERIFY_READY_ATTEMPTS:-180}"
  [[ "$ready_attempts" =~ ^[1-9][0-9]*$ ]] || die "STAAASH_VERIFY_READY_ATTEMPTS must be a positive integer"
  STAAASH_VERIFY_DB_PASSWORD="$db_password"
  STAAASH_VERIFY_AUTH_SECRET="$auth_secret"
  STAAASH_VERIFY_READY_ATTEMPTS="$ready_attempts"
  STAAASH_VERIFY_WEB_PORT=''
  STAAASH_VERIFY_TAILNET_PORT=''
  STAAASH_VERIFY_DB_PORT=''
  STAAASH_VERIFY_LOOPBACK_URL='http://127.0.0.1'
  STAAASH_VERIFY_TAILNET_URL=''
  STAAASH_VERIFY_URL="$STAAASH_VERIFY_LOOPBACK_URL"
  STAAASH_VERIFY_PROBE_URL="$STAAASH_VERIFY_LOOPBACK_URL"
  set_resource_defaults

  mkdir -p -- "$STATE_DIR" "$STAAASH_VERIFY_EVIDENCE_DIR"
  write_run_env
  write_compose_network

  load_run "$STATE_DIR/run.env"
  trap cleanup_failed_launch EXIT INT TERM
  write_run_info

  docker buildx create --name "$STAAASH_VERIFY_BUILDER" --driver docker-container \
    >"$EVIDENCE_DIR/builder-create.log" 2>&1
  docker buildx build \
    --builder "$STAAASH_VERIFY_BUILDER" \
    --load \
    --tag "$STAAASH_VERIFY_IMAGE" \
    "$REPO_ROOT" >"$EVIDENCE_DIR/build.log" 2>&1
  compose up --detach db staaash worker >"$EVIDENCE_DIR/compose-up.log" 2>&1
  read_published_ports
  write_run_env
  load_run "$STATE_DIR/run.env"
  write_run_info
  wait_for_app

  trap - EXIT INT TERM
  printf 'verify-staaash: project=%s\n' "$STAAASH_VERIFY_PROJECT" >&2
  printf 'verify-staaash: open %s\n' "$STAAASH_VERIFY_URL" >&2
  printf 'verify-staaash: loopback URL %s\n' "$STAAASH_VERIFY_LOOPBACK_URL" >&2
  if [[ "$STAAASH_VERIFY_SHARE" == tailnet ]]; then
    printf 'verify-staaash: tailnet URL %s\n' "$STAAASH_VERIFY_TAILNET_URL" >&2
  fi
  printf 'verify-staaash: evidence=%s\n' "$EVIDENCE_DIR" >&2
  printf '%s/run.env\n' "$STATE_DIR"
}

check_web_ports() {
  local container="${STAAASH_VERIFY_PROJECT}_web"
  local -a bindings=()
  mapfile -t bindings < <(docker port "$container" 2113/tcp)
  local expected_count=1
  [[ "$STAAASH_VERIFY_SHARE" == tailnet ]] && expected_count=2
  [[ "${#bindings[@]}" -eq "$expected_count" ]] ||
    die "doctor found $container with ${#bindings[@]} web bindings; expected $expected_count"

  local binding target host port loopback_found=0 tailnet_found=0
  for binding in "${bindings[@]}"; do
    target="${binding#*-> }"
    [[ "$target" != "$binding" ]] || target="$binding"
    host="${target%:*}"
    port="${target##*:}"
    case "$host" in
      0.0.0.0|::|\[::\]) die "doctor found a wildcard web port binding" ;;
      127.0.0.1)
        [[ "$port" == "$STAAASH_VERIFY_WEB_PORT" ]] ||
          die "doctor found the wrong loopback web port: $binding"
        loopback_found=1
        ;;
      "$STAAASH_VERIFY_TAILNET_IP")
        [[ "$STAAASH_VERIFY_SHARE" == tailnet && "$port" == "$STAAASH_VERIFY_TAILNET_PORT" ]] ||
          die "doctor found an unexpected tailnet web port: $binding"
        tailnet_found=1
        ;;
      *) die "doctor found an unexpected web port binding: $binding" ;;
    esac
  done
  [[ "$loopback_found" -eq 1 ]] || die "doctor could not find the loopback web port binding"
  if [[ "$STAAASH_VERIFY_SHARE" == tailnet ]]; then
    [[ "$tailnet_found" -eq 1 ]] || die "doctor could not find the tailnet web port binding"
  fi
}

check_db_ports() {
  local container="${STAAASH_VERIFY_PROJECT}_db"
  local -a bindings=()
  mapfile -t bindings < <(docker port "$container" 5432/tcp)
  [[ "${#bindings[@]}" -eq 1 ]] ||
    die "doctor found $container with ${#bindings[@]} database bindings"

  local target host port
  target="${bindings[0]#*-> }"
  [[ "$target" != "${bindings[0]}" ]] || target="${bindings[0]}"
  host="${target%:*}"
  port="${target##*:}"
  case "$host" in
    0.0.0.0|::|\[::\]) die "doctor found a wildcard database port binding" ;;
    127.0.0.1)
      [[ "$port" == "$STAAASH_VERIFY_DB_PORT" ]] ||
        die "doctor found the wrong loopback database port: ${bindings[0]}"
      ;;
    *) die "doctor found an unexpected database port binding: ${bindings[0]}" ;;
  esac
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

  local web_ports
  web_ports="$(docker port "${STAAASH_VERIFY_PROJECT}_web" 2113/tcp)"
  printf '%s\n' "$web_ports" >"$EVIDENCE_DIR/doctor-web-port.txt"
  check_web_ports
  local db_ports
  db_ports="$(docker port "${STAAASH_VERIFY_PROJECT}_db" 5432/tcp)"
  printf '%s\n' "$db_ports" >"$EVIDENCE_DIR/doctor-db-port.txt"
  check_db_ports
  curl --silent --show-error --fail --max-time 5 \
    "$STAAASH_VERIFY_PROBE_URL/api/health/live" >"$EVIDENCE_DIR/doctor-live.json"
  curl --silent --show-error --fail --max-time 5 \
    "$STAAASH_VERIFY_URL/api/health/live" >"$EVIDENCE_DIR/doctor-public-live.json"
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
  remove_resources || die "cleanup failed; run.env kept; see $EVIDENCE_DIR/cleanup.log"
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

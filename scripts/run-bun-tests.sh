#!/usr/bin/env bash

set -euo pipefail

readonly isolated_tests=(
  "tests/unit/sceneCaptionServer.test.ts"
  "tests/unit/triggerRoutes.test.ts"
)

declare -a bun_args=()
declare -a requested_tests=()
declare -a shared_tests=()
declare -a test_filters=()
reading_bun_args=false

for arg in "$@"; do
  if [[ "$arg" == "--" && "$reading_bun_args" == false ]]; then
    reading_bun_args=true
  elif [[ "$reading_bun_args" == true ]]; then
    bun_args+=("$arg")
  elif [[ -f "$arg" ]]; then
    requested_tests+=("${arg#./}")
  elif [[ -d "$arg" ]]; then
    while IFS= read -r test_file; do
      requested_tests+=("${test_file#./}")
    done < <(find "$arg" -type f -name '*.test.ts' | sort)
  elif [[ "$arg" == -* ]]; then
    printf 'Bun test options must follow an explicit -- separator.\n' >&2
    printf 'Example: bun run test clientTriggerRuns -- --timeout 1000 -t "returns successful output"\n' >&2
    exit 2
  else
    test_filters+=("$arg")
  fi
done

if ((${#requested_tests[@]} == 0)); then
  while IFS= read -r test_file; do
    requested_tests+=("$test_file")
  done < <(find tests -type f -name '*.test.ts' | sort)
fi

if ((${#test_filters[@]} > 0)); then
  declare -a filtered_tests=()
  for test_file in "${requested_tests[@]}"; do
    for test_filter in "${test_filters[@]}"; do
      if [[ "$test_file" == *"$test_filter"* ]]; then
        filtered_tests+=("$test_file")
        break
      fi
    done
  done
  if ((${#filtered_tests[@]} == 0)); then
    if ((${#bun_args[@]} > 0)); then
      bun test "${bun_args[@]}" "${test_filters[@]}"
    else
      bun test "${test_filters[@]}"
    fi
    exit $?
  fi
  requested_tests=("${filtered_tests[@]}")
fi

is_isolated_test() {
  local candidate="$1"
  local isolated_test
  for isolated_test in "${isolated_tests[@]}"; do
    [[ "$candidate" == "$isolated_test" ]] && return 0
  done
  return 1
}

run_bun_tests() {
  if ((${#bun_args[@]} > 0)); then
    bun test "${bun_args[@]}" "$@"
  else
    bun test "$@"
  fi
}

for test_file in "${requested_tests[@]}"; do
  is_isolated_test "$test_file" || shared_tests+=("$test_file")
done

if ((${#shared_tests[@]} > 0)); then
  run_bun_tests "${shared_tests[@]}"
fi

for isolated_test in "${isolated_tests[@]}"; do
  for requested_test in "${requested_tests[@]}"; do
    if [[ "$requested_test" == "$isolated_test" ]]; then
      run_bun_tests "$isolated_test"
      break
    fi
  done
done

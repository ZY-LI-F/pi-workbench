#!/usr/bin/env bash

stella_repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
stella_companion_dir="${stella_repo_dir}/apps/companion"

if [[ -z "${JAVA_HOME:-}" && -d "/Applications/Android Studio.app/Contents/jbr/Contents/Home" ]]; then
  export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
fi

if [[ -z "${ANDROID_HOME:-}" && -z "${ANDROID_SDK_ROOT:-}" ]]; then
  stella_default_android_sdk="${HOME}/Library/Android/sdk"
  if [[ -d "${stella_default_android_sdk}" ]]; then
    export ANDROID_HOME="${stella_default_android_sdk}"
  fi
fi

if [[ -z "${JAVA_HOME:-}" ]]; then
  echo "JAVA_HOME 未配置，且没有找到 Android Studio JBR。" >&2
  exit 1
fi
if [[ -z "${ANDROID_HOME:-}${ANDROID_SDK_ROOT:-}" ]]; then
  echo "ANDROID_HOME 或 ANDROID_SDK_ROOT 未配置。" >&2
  exit 1
fi

stella_android_sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT}}"

#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
companion_dir="${repo_dir}/apps/companion"

if [[ -z "${JAVA_HOME:-}" && -d "/Applications/Android Studio.app/Contents/jbr/Contents/Home" ]]; then
  export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
fi

if [[ -z "${ANDROID_HOME:-}" && -z "${ANDROID_SDK_ROOT:-}" ]]; then
  default_android_sdk="${HOME}/Library/Android/sdk"
  if [[ -d "${default_android_sdk}" ]]; then
    export ANDROID_HOME="${default_android_sdk}"
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

npm --prefix "${companion_dir}" run cap:sync
(
  cd "${companion_dir}/android"
  ./gradlew assembleDebug
)

apk_path="${companion_dir}/android/app/build/outputs/apk/debug/app-debug.apk"
if [[ ! -f "${apk_path}" ]]; then
  echo "Gradle 完成但未找到 APK: ${apk_path}" >&2
  exit 1
fi

echo "APK: ${apk_path}"
shasum -a 256 "${apk_path}"

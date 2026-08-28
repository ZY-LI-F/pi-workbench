#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/companion-android-env.sh"

npm --prefix "${stella_companion_dir}" run cap:sync
(
  cd "${stella_companion_dir}/android"
  ./gradlew assembleDebug
)

stella_apk_path="${stella_companion_dir}/android/app/build/outputs/apk/debug/app-debug.apk"
if [[ ! -f "${stella_apk_path}" ]]; then
  echo "Gradle 完成但未找到 APK: ${stella_apk_path}" >&2
  exit 1
fi

echo "APK: ${stella_apk_path}"
shasum -a 256 "${stella_apk_path}"

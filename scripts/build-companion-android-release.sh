#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/companion-android-env.sh"

for stella_required_variable in \
  STELLA_ANDROID_KEYSTORE \
  STELLA_ANDROID_KEYSTORE_PASSWORD \
  STELLA_ANDROID_KEY_ALIAS \
  STELLA_ANDROID_KEY_PASSWORD; do
  if [[ -z "${!stella_required_variable:-}" ]]; then
    echo "缺少 release signing 变量: ${stella_required_variable}" >&2
    exit 1
  fi
done

if [[ ! -f "${STELLA_ANDROID_KEYSTORE}" ]]; then
  echo "Release keystore 不存在: ${STELLA_ANDROID_KEYSTORE}" >&2
  exit 1
fi

npm --prefix "${stella_companion_dir}" run cap:sync
(
  cd "${stella_companion_dir}/android"
  ./gradlew assembleRelease
)

stella_unsigned_path="${stella_companion_dir}/android/app/build/outputs/apk/release/app-release.apk"
if [[ ! -f "${stella_unsigned_path}" ]]; then
  echo "Gradle 完成但未找到 release APK: ${stella_unsigned_path}" >&2
  exit 1
fi

shopt -s nullglob
stella_apksigner_candidates=("${stella_android_sdk}"/build-tools/*/apksigner)
shopt -u nullglob
if [[ ${#stella_apksigner_candidates[@]} -eq 0 ]]; then
  echo "Android SDK 中没有找到 apksigner。" >&2
  exit 1
fi
stella_apksigner="${stella_apksigner_candidates[${#stella_apksigner_candidates[@]} - 1]}"
"${stella_apksigner}" verify --verbose --print-certs "${stella_unsigned_path}"

stella_release_dir="${stella_repo_dir}/release"
stella_artifact_name="Stella-Companion-0.5.0-android-vc${STELLA_ANDROID_VERSION_CODE:-6}.apk"
mkdir -p "${stella_release_dir}"
cp "${stella_unsigned_path}" "${stella_release_dir}/${stella_artifact_name}"
(
  cd "${stella_repo_dir}"
  STELLA_CHECKSUM_EXTENSIONS=apk \
    STELLA_CHECKSUM_MANIFEST=SHA256SUMS-android.txt \
    npm run release:checksums
)

echo "APK: ${stella_release_dir}/${stella_artifact_name}"
grep "${stella_artifact_name}" "${stella_release_dir}/SHA256SUMS-android.txt"

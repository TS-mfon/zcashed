#!/usr/bin/env bash
set -euo pipefail
umask 077
runtime_dir="${RUNNER_TEMP:?}/zcashed-runtime"
mkdir -p "$runtime_dir"
curl --fail --location --retry 3 --silent --show-error \
  'https://github.com/zingolabs/zingo-pc/releases/download/zingo-pc-2.0.28-204/zingo-pc_2.0.28-204_amd64.deb' \
  --output "$runtime_dir/zingo-pc.deb"
# Authenticate executable downloads against the official release digests.
echo "e53ab75361bc6b400b22cd967a993f116b9ccb062121f7e79c983336453955dc  $runtime_dir/zingo-pc.deb" | sha256sum --check --status
dpkg-deb --extract "$runtime_dir/zingo-pc.deb" "$runtime_dir/zingo-pc"
curl --fail --location --retry 3 --silent --show-error \
  'https://github.com/cloudflare/cloudflared/releases/download/2026.11.0/cloudflared-linux-amd64' \
  --output "$runtime_dir/cloudflared"
echo "51f7c68b57ed7269164075d7e789efce5b59355982f06392deeb037d982a51fd  $runtime_dir/cloudflared" | sha256sum --check --status
chmod 700 "$runtime_dir/cloudflared"

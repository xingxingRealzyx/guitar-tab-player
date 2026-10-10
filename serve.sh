#!/bin/sh
# TabDeck 本地服务：ES module worker + AudioWorklet 需要 http(s)，不能直接双击 index.html
PORT="${1:-8777}"
echo "TabDeck → http://127.0.0.1:${PORT}/"
exec python3 -m http.server "$PORT" --bind 127.0.0.1

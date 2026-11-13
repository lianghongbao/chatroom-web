#!/usr/bin/env bash
# 算出 Playwright Chromium 能跑的 LD_LIBRARY_PATH。
# WSL 里 Playwright 自带的 chrome-headless-shell 缺图形库，但 snap 装的 chromium 有；
# 不能把 snap 的 lib 目录全塞进去 —— core20 里的老 libc 会让 ld.so 直接崩，
# 所以这里只挑真正缺的那几个 .so 所在目录并排除 core20。
#
# 用法： source tests/chromium-env.sh

BIN=$(ls -d /home/lhb/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell 2>/dev/null | head -1)
if [ -z "$BIN" ]; then
	export LD_LIBRARY_PATH="$LD_LIBRARY_PATH"
	return 0 2>/dev/null || exit 0
fi

_needs="libatk-1.0.so.0 libatk-bridge-2.0.so.0 libcups.so.2 libpango-1.0.so.0
libpangocairo-1.0.so.0 libcairo.so.2 libasound.so.2 libnspr4.so libnss3.so
libxkbcommon.so.0 libatspi.so.0 libXcomposite.so.1 libXdamage.so.1
libXfixes.so.3 libXrandr.so.2 libgbm.so.1 libdrm.so.2 libexpat.so.1
libxcb.so.1 libXext.so.6 libX11.so.6 libxcb-dri3.so.0 libxcb-present.so.0
libxcb-sync.so.1 libxshmfence.so.1 libXi.so.6 libXtst.so.6 libglib-2.0.so.0
libgobject-2.0.so.0 libgio-2.0.so.0 libdbus-1.so.3 libxshm.so.1"

_dirs=""
for _l in $_needs; do
	# 只取 64 位版本 —— snap 里往往同时有 i386 那份，
	# head -1 抓到 32 位的话路径对了也链不上（符号版本对不上）。
	# 注意别用 grep -v '/x86/' —— 那会把 x86_64-linux-gnu 也滤掉。
	_p=$(find /snap /usr/lib /usr/local/lib -name "$_l" 2>/dev/null |
		grep -v '/core20/' | grep -v 'i386' |
		grep -v '/share/doc' | head -1)
	[ -z "$_p" ] && continue
	_d=$(dirname "$_p")
	case ":$_dirs:" in
	*":$_d:"*) ;;
	*) _dirs="$_dirs:$_d" ;;
	esac
done
_dirs=${_dirs#:}
export LD_LIBRARY_PATH="$_dirs${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
unset BIN _needs _dirs _l _p _d

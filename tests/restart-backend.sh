#!/usr/bin/env bash
# 重启全部 5 个 chatroom 服务（本地开发用）。
#
# 先按二进制名精确停掉旧进程，再重新编译启动 ——
# 否则旧进程会占着端口，新二进制起不来，
# 于是「改了代码但行为没变」，排查起来很浪费时间。
set -uo pipefail

ROOT=/mnt/d/Learn/go-project/chatroom
SERVICES=(user friend conversation message ws-gateway)

export NACOS_SERVERS='127.0.0.1:8848'
export NACOS_NAMESPACE='3dbbf765-11cf-4622-817f-d890cd670ba0'
export NACOS_GROUP='DEFAULT_GROUP'
export NACOS_USERNAME='nacos'
export NACOS_PASSWORD='123456'
export REDIS_ADDR='127.0.0.1:6379'
export DB_SOURCE='root:123456@tcp(127.0.0.1:3306)/test?parseTime=true&loc=Local&charset=utf8mb4'
export AUTH_JWT_SECRET='chatroom-dev-jwt-secret-please-change-in-production-32bytes'
export AUTH_INTERNAL_SECRET='chatroom-dev-internal-secret-please-change-in-production'
export OTEL_EXPORTER_OTLP_ENDPOINT='127.0.0.1:4317'

echo "→ 停旧进程"
# 直接读 /proc/<pid>/comm 找名字匹配的进程 —— pkill/pgrep 的 -x 走精确匹配，
# 而 comm 最长 15 字符会被截断（cr-ws-gateway-service → cr-ws-gateway-s），
# 按完整名 pkill 反而匹配不上。
for pid in /proc/[0-9]*; do
	comm=$(cat "$pid/comm" 2>/dev/null) || continue
	case "$comm" in
	cr-user-* | cr-friend-* | cr-conversation* | cr-message-* | cr-ws-gateway-*)
		kill "${pid#/proc/}" 2>/dev/null
		;;
	esac
done
sleep 3
left=0
for pid in /proc/[0-9]*; do
	comm=$(cat "$pid/comm" 2>/dev/null) || continue
	case "$comm" in
	cr-user-* | cr-friend-* | cr-conversation* | cr-message-* | cr-ws-gateway-*)
		left=$((left + 1))
		;;
	esac
done
[ "$left" -eq 0 ] || { echo "还有 $left 个旧进程没停掉" >&2; exit 1; }

echo "→ 编译"
for svc in "${SERVICES[@]}"; do
	if ! (cd "$ROOT/${svc}-service" && go build -o "/tmp/cr-${svc}-service" ./cmd/...); then
		echo "编译失败: ${svc}" >&2
		exit 1
	fi
done

echo "→ 启动"
for svc in "${SERVICES[@]}"; do
	# setsid 让子进程脱离当前会话 —— 否则它会继承 stdout，
	# 调用方的管道要等它退出才闭合，脚本看着就像卡住了。
	(cd "$ROOT/${svc}-service" && setsid "/tmp/cr-${svc}-service" >"/tmp/${svc}.log" 2>&1 </dev/null &)
done

sleep 12
up=$(ss -ltn | grep -cE ':800[0-4]')
echo "→ 监听端口数: $up / 5"
[ "$up" -eq 5 ] || { echo "有服务没起来" >&2; exit 1; }

# Genzo 个人 WebDAV 部署准备

服务器只存个人资料，不存媒体或运行中的 SQLite。此配置供审阅，尚未部署到阿里云。当前本机无 Docker，因此未声称容器或生产 Apache 验证通过；共享核心已通过隔离 HTTP 服务的认证/ETag/故障测试。客户端实际启用前仍会实测服务能力。

## 部署前必须确认

用户指定的 SSH 配置名、服务器地址/系统/架构、已有服务、80/443 使用情况、安全组/防火墙、域名 DNS、证书策略、持久目录与备份位置。已有网站占用端口时，不直接启动本配置的 Caddy；由现有 HTTPS 入口转发到内部 WebDAV，并保留认证和条件请求头。密码和私钥不要放聊天、Git 或 `.env.example`。

## 审阅后的 Linux/Docker 操作

配置使用官方 `httpd:2.4.69-alpine`（Apache-2.0）与 `caddy:2.11.6-alpine`（Apache-2.0），版本在 [Docker 官方 httpd 清单](https://github.com/docker-library/official-images/blob/master/library/httpd) 与 [Caddy 清单](https://github.com/docker-library/official-images/blob/master/library/caddy) 核对。上线时记录拉取到的镜像 digest，生产固定 digest；定期检查安全更新并重新跑能力探测。

1. 将这份目录放到明确的服务器持久目录，复制 `.env.example` 为 `.env`，填写域名和证书联系人。
2. 创建 `data/library`、`data/locks`、`data/empty` 和 `secrets`。Apache 镜像中的 `daemon` UID/GID 需先以 `id daemon` 核对，将 `data` 设为其可读写；不要使用 777。
3. 用镜像自带的 `htpasswd` 交互输入密码，生成个人账号文件（密码不出现在参数或 shell 历史）：

```sh
docker run --rm -it -v "$PWD/secrets:/secrets" httpd:2.4.69-alpine htpasswd -cB /secrets/users.htpasswd genzo
```

账号文件只允许管理者写，需允许 Apache daemon 读取。变更密码用去掉 `-c` 的命令，避免清空已有账号。

4. `docker compose config` 审阅展开结果；`docker compose run --rm webdav httpd -t` 验证 Apache；`docker compose run --rm https caddy validate --config /etc/caddy/Caddyfile` 验证入口。确认已有服务与安全组后再 `docker compose up -d`。
5. Genzo 填 `https://实际域名/genzo/`，测试连接，确认认证/读写/强 ETag/过期条件请求均通过。第一台创建，第二台加入。不得绕过 `CONDITION_UNSUPPORTED`。TLS 错误要修复证书/DNS，不关闭验证。

依据 [Apache mod_dav](https://httpd.apache.org/docs/2.4/mod/mod_dav.html) 与 [Caddy reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)。不启用公共目录列表，不对公网映射内部 8080。单个文档上限 16 MiB，与客户端一致。

## 备份与恢复

- `data/library/state.json` 含不可裁剪的操作和删除记录。每日备份 `data/library` 与账号文件；Caddy 证书卷按现有服务器备份方案处理。备份含私人笔记，限制访问并建议离线加密保存。
- 暂停/停止 `webdav` 后备份，或用文件系统一致性快照。备份放到独立目录/另一存储，不覆盖唯一副本；保留多个日期与 SHA-256 校验信息。
- 恢复前暂停所有客户端、备份当前目录，确认 libraryId 与协议版本。恢复时保持原 libraryId，不另建空文档。删除历史缺失时旧设备可能补回其保留的操作，必须先演练恢复再重新启用。
- 首次生产验收：HTTPS 证书、错误密码拒绝、两设备同步、并发写 412、断网保留待传、服务器重启数据保留、备份恢复。部署和这组验收尚未运行。

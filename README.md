# dsh-worklog-calendar

A work log calendar inside [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): open the left-sidebar entry and see what each day actually did, rebuilt from your own session logs.

## What it shows

- **A month calendar in the panel** — every day is shaded by how much work happened in it, with that day's session count underneath and a dot when a turn was interrupted. Monday-first, today outlined, the selected day ringed.
- **The selected day's overview** — sessions, turns, your own prompts, tool calls, active hours and tokens, the day's most-used tools, and then one card per session: title, time span, top tools, working directory and the first prompt. Clicking a card opens that session.
- **It opens on today** and switches by date: click a day, page months, or use the arrow keys (`Home` / `End` for the first and last day of a month, `PageUp` / `PageDown` to change month). Today's numbers refresh every minute while the panel is open.

Only a person's own input counts as a prompt — injected runtime context, skill catalogs and plugin recalls also arrive as user messages in the log, and they are filtered out.

## Install

```sh
dsh plugin --profile desktop add dsh-worklog-calendar
```

On the desktop app, install it from **Plugins → Add plugin**, or enable it after installing from this directory. A restart is needed the first time the bundle is added to a profile.

## What it reads

Everything comes from the local session logs through the Host `sessionQuery` service. It is read-only: the plugin never writes an event, never changes a session, and sends nothing anywhere.

The Host half exposes two JSON feeds on the same origin — `/api/dsh-worklog-calendar/day` and `/api/dsh-worklog-calendar/month` — registered through the connection fetch layer, so they sit behind the same access check as the rest of the Harness API (an unauthenticated request gets `401`). Both are cached: 20 s for today's numbers, 10 minutes for a past day.

## Requirements

DeepSeek Harness `>=0.2.2-rc.1 <0.3.0` (tested on `0.2.2-rc.3`). Node.js 20 or newer.

## Structure

| File | Role |
| --- | --- |
| `index.js` | Host: folds session logs into per-day digests and serves the two read-only feeds |
| `client.js` | Client: the sidebar entry and the calendar panel |
| `cordis.patch.yml` | Bundle row |
| `locale/*.json` | Plugin Manager title and description |
| `docs/` | The bundle's detail document and its illustration |
| `icon.svg` | Bundle icon |

## Turning it off

Disable `dsh-worklog-calendar` in **Plugins**. The sidebar entry and both feeds disappear with it.

## License

MIT

---

## 中文

左侧栏的「工作日志」入口，点开是工作日志月历：每格按当天的活跃度着色、下方是当天会话数、有中断时点一个红点；默认显示今天，可切任意日期。右侧是选中日的概览——会话、轮次、提问、工具调用、活跃时段、Token，当天常用工具，以及每个会话的标题、时间、主要工具、工作目录和第一句提问；点会话卡片直接打开它。

数据全部来自本机会话日志（Host `sessionQuery`，只读），不外发；两个同源只读接口 `/api/dsh-worklog-calendar/day` 与 `/month` 走连接层的访问校验，未鉴权请求返回 `401`。要求 DSH `>=0.2.2-rc.1 <0.3.0`。

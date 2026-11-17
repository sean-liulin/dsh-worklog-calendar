/**
 * Client half of dsh-worklog-calendar: a left-sidebar entry that opens a work calendar.
 *
 * The calendar month grid shows a heat dot per day; the overview below it is
 * the selected day's work (sessions, turns, prompts, tool calls), defaulting to
 * today. Data comes from the Host feeds /api/dsh-worklog-calendar/month and /day.
 */
window.__ModuleLoader__.load({
  id: 'dsh-worklog-calendar',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } = React

    const PANEL_ID = 'worklog'
    const NS = 'dsh-worklog-calendar'
    const REFRESH_MS = 60_000
    const WEEKDAY_KEYS = ['cal.wd1', 'cal.wd2', 'cal.wd3', 'cal.wd4', 'cal.wd5', 'cal.wd6', 'cal.wd7']
    /** Stable identity for "no month data yet", so memos do not churn. */
    const EMPTY_DAYS = {}

    const DICT = {
      'zh-CN': {
        'panel.title': '工作日志',
        'cal.prev': '上个月',
        'cal.next': '下个月',
        'cal.today': '今天',
        'cal.wd1': '一',
        'cal.wd2': '二',
        'cal.wd3': '三',
        'cal.wd4': '四',
        'cal.wd5': '五',
        'cal.wd6': '六',
        'cal.wd7': '日',
        'cal.grid': '月历，用方向键切换日期',
        'cal.none': '无记录',
        'cal.worked': '有工作',
        'cal.summary': '{sessions} 个会话 · {turns} 轮',
        'day.empty': '这一天没有工作记录',
        'day.loading': '正在读取…',
        'day.truncated': '会话太多，只统计了最近 {count} 个',
        'stat.sessions': '会话',
        'stat.turns': '轮次',
        'stat.prompts': '提问',
        'stat.tools': '工具调用',
        'stat.errors': '中断',
        'stat.window': '活跃时段',
        'stat.tokens': 'Token',
        'section.sessions': '会话',
        'section.tools': '常用工具',
        'session.open': '打开会话',
        'session.untitled': '未命名会话',
        'session.subagent': '子代理',
        'session.live': '进行中',
        'common.refresh': '刷新',
        'common.error': '读取失败',
        'common.retry': '重试',
        'common.empty': '—',
      },
      en: {
        'panel.title': 'Work log',
        'cal.prev': 'Previous month',
        'cal.next': 'Next month',
        'cal.today': 'Today',
        'cal.wd1': 'M',
        'cal.wd2': 'T',
        'cal.wd3': 'W',
        'cal.wd4': 'T',
        'cal.wd5': 'F',
        'cal.wd6': 'S',
        'cal.wd7': 'S',
        'cal.grid': 'Month calendar; use the arrow keys to change the date',
        'cal.none': 'No work',
        'cal.worked': 'Has work',
        'cal.summary': '{sessions} sessions · {turns} turns',
        'day.empty': 'No work recorded on this day',
        'day.loading': 'Loading…',
        'day.truncated': 'Only the latest {count} sessions were counted',
        'stat.sessions': 'Sessions',
        'stat.turns': 'Turns',
        'stat.prompts': 'Prompts',
        'stat.tools': 'Tool calls',
        'stat.errors': 'Interrupted',
        'stat.window': 'Active window',
        'stat.tokens': 'Tokens',
        'section.sessions': 'Sessions',
        'section.tools': 'Top tools',
        'session.open': 'Open session',
        'session.untitled': 'Untitled session',
        'session.subagent': 'Subagent',
        'session.live': 'Live',
        'common.refresh': 'Refresh',
        'common.error': 'Could not load',
        'common.retry': 'Retry',
        'common.empty': '—',
      },
    }

    const CSS = `
.wl-root{height:100%;overflow:auto;padding:20px 24px 32px;box-sizing:border-box;
  color:var(--dsw-alias-label-primary,#1f2328);font:inherit;font-size:13px;line-height:1.5;
  container-type:inline-size}
.wl-head{margin-bottom:14px}
.wl-title{margin:0;font-size:16px;font-weight:600;line-height:1.3}
.wl-sub{color:var(--dsw-alias-label-secondary,#5c6570);font-size:12px}
.wl-nav{display:flex;align-items:center;gap:4px;margin-left:auto}
.wl-month{font-size:13px;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}
.wl-cal-nav{display:flex;align-items:center;gap:4px;margin-bottom:10px}
.wl-btn{border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));background:var(--dsw-alias-bg-layer-1,#fff);
  color:var(--dsw-alias-label-primary,#1f2328);border-radius:8px;height:28px;padding:0 10px;font:inherit;font-size:12px;
  line-height:1;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:4px;
  transition:background-color .15s ease,border-color .15s ease}
.wl-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));border-color:var(--dsw-alias-border-l3,rgba(0,0,0,.18))}
.wl-btn:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary,#4d6bfe));outline-offset:1px}
.wl-btn:disabled{opacity:.45;cursor:default}
.wl-btn-ico{width:28px;padding:0;font-size:15px}
.wl-layout{display:grid;grid-template-columns:minmax(280px,340px) minmax(0,1fr);gap:16px;align-items:start}
.wl-card{border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));background:var(--dsw-alias-bg-layer-1,#fff);
  border-radius:12px;padding:12px 14px;min-width:0}
.wl-week{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}
.wl-wd{text-align:center;color:var(--dsw-alias-label-tertiary,#8b93a1);font-size:11px;line-height:20px}
.wl-cal .wl-week{margin-bottom:4px}
.wl-cal-grid{display:flex;flex-direction:column;gap:4px}
.wl-row{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}
.wl-grid{outline:none}
.wl-grid:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary,#4d6bfe));outline-offset:2px;border-radius:10px}
.wl-cell{position:relative;aspect-ratio:1/1;min-height:36px;border:0;border-radius:9px;padding:0;
  background:color-mix(in srgb, var(--dsw-alias-brand-primary,#4d6bfe) var(--wl-heat,0%), transparent);
  color:inherit;font:inherit;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;
  transition:background-color .15s ease,box-shadow .15s ease}
.wl-cell:hover{box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l3,rgba(0,0,0,.18))}
.wl-cell:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary,#4d6bfe));outline-offset:1px}
.wl-cell-out{color:var(--dsw-alias-label-tertiary,#8b93a1)}
.wl-cell-future{cursor:default;opacity:.55;color:var(--dsw-alias-label-tertiary,#8b93a1)}
.wl-cell-future:hover{box-shadow:none}
.wl-cell-today{box-shadow:inset 0 0 0 1px var(--dsw-alias-label-secondary,#5c6570)}
.wl-cell-sel,.wl-cell-sel:hover{box-shadow:inset 0 0 0 2px var(--dsw-alias-brand-primary,#4d6bfe)}
.wl-num{font-size:12px;font-variant-numeric:tabular-nums;line-height:1.2}
.wl-cell-sel .wl-num{font-weight:700}
.wl-cell-today .wl-num{font-weight:600;color:var(--dsw-alias-brand-primary,#4d6bfe)}
.wl-meta{font-size:9.5px;line-height:1.1;color:var(--dsw-alias-label-secondary,#5c6570);font-variant-numeric:tabular-nums}
.wl-cell-sel .wl-meta{color:var(--dsw-alias-label-primary,#1f2328)}
.wl-dot{width:4px;height:4px;border-radius:50%;background:var(--dsw-alias-state-error-primary,#e5484d)}
.wl-legend{display:flex;align-items:center;gap:6px;margin-top:10px;color:var(--dsw-alias-label-tertiary,#8b93a1);font-size:10.5px}
.wl-legend-swatch{width:10px;height:10px;border-radius:3px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));flex:none}
.wl-legend-swatch-empty{background:transparent;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12))}
.wl-legend-swatch-fill{background:color-mix(in srgb, var(--dsw-alias-brand-primary,#4d6bfe) 45%, transparent);border-color:transparent}
.wl-dayhead{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px}
.wl-day-title{margin:0;font-size:13px;font-weight:600;min-width:0}
.wl-badge{border:1px solid color-mix(in srgb, var(--dsw-alias-brand-primary,#4d6bfe) 45%, transparent);
  color:var(--dsw-alias-brand-primary,#4d6bfe);border-radius:999px;padding:0 7px;font-size:10.5px;line-height:1.7}
.wl-dayhead .wl-btn{margin-left:auto}
.wl-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(78px,1fr));gap:8px;margin:0 0 12px}
.wl-stat{margin:0;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));border-radius:10px;
  background:var(--dsw-alias-bg-layer-2,#f5f7fa);padding:7px 9px;min-width:0}
.wl-stat dt{color:var(--dsw-alias-label-secondary,#5c6570);font-size:10.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wl-stat dd{margin:1px 0 0;font-size:16px;font-weight:600;line-height:1.25;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wl-stat-wide dd{font-size:13px;font-weight:600}
.wl-tools{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
.wl-chip{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));border-radius:999px;
  padding:1px 8px;font-size:10.5px;color:var(--dsw-alias-label-secondary,#5c6570);white-space:nowrap;max-width:100%}
.wl-chip b{color:var(--dsw-alias-label-primary,#1f2328);font-variant-numeric:tabular-nums;font-weight:600}
.wl-chip-bad{color:var(--dsw-alias-state-error-primary,#e5484d);border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary,#e5484d) 40%, transparent)}
.wl-list{display:flex;flex-direction:column;gap:9px;max-height:clamp(260px,calc(100vh - 360px),720px);overflow-y:auto;overscroll-behavior:contain;padding-right:4px;scrollbar-gutter:stable;scrollbar-width:thin}
.wl-list-title{margin:0 0 7px;font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary,#5c6570);letter-spacing:.02em}
.wl-session{width:100%;box-sizing:border-box;text-align:left;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));
  background:var(--dsw-alias-bg-layer-2,#f5f7fa);border-radius:10px;padding:9px 11px;font:inherit;color:inherit;cursor:pointer;
  display:flex;flex-direction:column;gap:6px;transition:background-color .15s ease,border-color .15s ease}
.wl-session:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));border-color:var(--dsw-alias-border-l3,rgba(0,0,0,.18))}
.wl-session:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary,#4d6bfe));outline-offset:1px}
.wl-session-static{cursor:default}
.wl-session-static:hover{background:var(--dsw-alias-bg-layer-2,#f5f7fa);border-color:var(--dsw-alias-border-l2,rgba(0,0,0,.12))}
.wl-session-top{display:flex;align-items:baseline;gap:8px;min-width:0}
.wl-session-title{font-size:12.5px;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wl-session-time{margin-left:auto;color:var(--dsw-alias-label-secondary,#5c6570);font-size:10.5px;font-variant-numeric:tabular-nums;white-space:nowrap;flex:none}
.wl-chips{display:flex;flex-wrap:wrap;gap:5px}
.wl-prompt{color:var(--dsw-alias-label-secondary,#5c6570);font-size:11px;line-height:1.5;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.wl-empty{color:var(--dsw-alias-label-secondary,#5c6570);font-size:12px;text-align:center;padding:26px 8px}
.wl-err{color:var(--dsw-alias-state-error-primary,#e5484d);font-size:12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 0}
.wl-skel{height:44px;border-radius:10px;background:var(--dsw-alias-bg-skeleton,rgba(0,0,0,.06));margin-bottom:8px}
.wl-note{color:var(--dsw-alias-label-tertiary,#8b93a1);font-size:10.5px;margin-top:10px}
@container (max-width: 760px){.wl-layout{grid-template-columns:minmax(0,1fr)}}
@media (max-width: 880px){.wl-layout{grid-template-columns:minmax(0,1fr)}}
`

    const pad2 = (value) => String(value).padStart(2, '0')
    const toKey = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
    const monthKeyOf = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`
    const addDays = (date, amount) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount)
    const addMonths = (date, amount) => new Date(date.getFullYear(), date.getMonth() + amount, 1)
    const startOfMonth = (date) => new Date(date.getFullYear(), date.getMonth(), 1)
    const clockText = (time) => {
      const date = new Date(time)
      return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
    }

    /** Dictionary for an active locale id; unknown or missing falls back to Chinese. */
    function tableFor(activeLocale) {
      return /^en\b/i.test(String(activeLocale ?? '')) ? DICT.en : DICT['zh-CN']
    }

    function format(localeId, options, date) {
      try {
        return new Intl.DateTimeFormat(localeId || 'zh-CN', options).format(date)
      } catch {
        return toKey(date)
      }
    }

    function monthCells(cursor) {
      const first = startOfMonth(cursor)
      const offset = (first.getDay() + 6) % 7
      const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
      const rows = Math.ceil((offset + daysInMonth) / 7)
      const start = addDays(first, -offset)
      const cells = []
      for (let index = 0; index < rows * 7; index += 1) {
        const date = addDays(start, index)
        cells.push({
          key: toKey(date),
          dayNumber: date.getDate(),
          inMonth: date.getMonth() === first.getMonth(),
        })
      }
      return cells
    }

    function dayScore(bucket) {
      if (!bucket) return 0
      return bucket.turns * 2 + bucket.toolCalls + bucket.prompts
    }

    async function getJson(path) {
      const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store' })
      let body = null
      try {
        body = await response.json()
      } catch {
        body = null
      }
      if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`)
      return body
    }

    function iconProps(active) {
      return { 'aria-hidden': true, focusable: false, 'data-active': active ? 'true' : 'false' }
    }

    function WorklogIcon({ size = 18, active = false }) {
      const edge = Number.isFinite(size) && size > 0 ? size : 18
      return h('svg', {
        viewBox: '0 0 24 24',
        width: edge,
        height: edge,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        opacity: active ? 1 : 0.86,
        ...iconProps(active),
      },
        h('rect', { x: 3.2, y: 5, width: 17.6, height: 15.4, rx: 3 }),
        h('path', { d: 'M3.2 9.6h17.6' }),
        h('path', { d: 'M8.2 3.4v3.2M15.8 3.4v3.2' }),
        h('path', { d: 'M7.6 13.2h2.2M11 13.2h2.2M14.4 13.2h2.2M7.6 16.6h2.2M11 16.6h2.2' }),
      )
    }

    function StatCell({ label, value, wide }) {
      return h('dl', { className: wide ? 'wl-stat wl-stat-wide' : 'wl-stat' },
        h('dt', null, label),
        h('dd', null, value))
    }
    function Chip({ children, bad }) {
      return h('span', { className: bad ? 'wl-chip wl-chip-bad' : 'wl-chip' }, children)
    }

    function useLocaleSnapshot(locale) {
      const subscribe = useCallback((notify) => {
        try {
          return locale?.subscribe ? locale.subscribe(notify) : () => {}
        } catch {
          return () => {}
        }
      }, [locale])
      const read = useCallback(() => {
        try {
          return locale?.getSnapshot?.() ?? null
        } catch {
          return null
        }
      }, [locale])
      return useSyncExternalStore(subscribe, read, read)
    }

    function basename(path) {
      if (typeof path !== 'string' || !path) return ''
      const parts = path.split(/[\\/]+/).filter(Boolean)
      return parts.length ? parts[parts.length - 1] : ''
    }

    /** Build the slot component with the plugin's translator and actions closed over. */
    function createPanel({ translate, localeService, openSession, canOpenSession }) {
      function WorklogPanel() {
        const snapshot = useLocaleSnapshot(localeService)
        const activeLocale = snapshot?.active || ''
        const localeId = /^en\b/i.test(activeLocale) ? 'en' : 'zh-CN'
        const t = useCallback((key) => translate(key, activeLocale), [translate, activeLocale])
        const todayKey = toKey(new Date())
        const [cursor, setCursor] = useState(() => startOfMonth(new Date()))
        const [selected, setSelected] = useState(todayKey)
        const [month, setMonth] = useState(null)
        const [day, setDay] = useState(null)
        const [monthError, setMonthError] = useState(null)
        const [dayError, setDayError] = useState(null)
        const [dayLoading, setDayLoading] = useState(true)
        const [nonce, setNonce] = useState(0)

        const monthKey = monthKeyOf(cursor)

        useEffect(() => {
          let alive = true
          getJson(`/api/dsh-worklog-calendar/month?month=${monthKey}`)
            .then((body) => {
              if (!alive) return
              setMonth(body)
              setMonthError(null)
            })
            .catch((cause) => {
              if (alive) setMonthError(cause instanceof Error ? cause.message : String(cause))
            })
          return () => {
            alive = false
          }
        }, [monthKey, nonce])

        useEffect(() => {
          let alive = true
          setDayLoading(true)
          // Never show one date's numbers under another date's heading.
          setDay((prev) => (prev && prev.date === selected ? prev : null))
          getJson(`/api/dsh-worklog-calendar/day?date=${selected}`)
            .then((body) => {
              if (!alive) return
              setDay(body)
              setDayError(null)
            })
            .catch((cause) => {
              if (alive) setDayError(cause instanceof Error ? cause.message : String(cause))
            })
            .finally(() => {
              if (alive) setDayLoading(false)
            })
          return () => {
            alive = false
          }
        }, [selected, nonce])

        // Keep today's numbers honest while the panel stays open.
        useEffect(() => {
          if (selected !== todayKey) return undefined
          const timer = setInterval(() => setNonce((value) => value + 1), REFRESH_MS)
          return () => clearInterval(timer)
        }, [selected, todayKey])

        const cells = useMemo(() => monthCells(cursor), [cursor])
        const days = useMemo(() => month?.days ?? EMPTY_DAYS, [month])
        const maxScore = useMemo(() => {
          let max = 0
          for (const value of Object.values(days)) max = Math.max(max, dayScore(value))
          return max
        }, [days])

        const currentMonthKey = todayKey.slice(0, 7)

        const goMonth = (delta) => {
          const next = addMonths(cursor, delta)
          const nextKey = monthKeyOf(next)
          if (nextKey > currentMonthKey) return
          setCursor(next)
          if (selected.slice(0, 7) === nextKey) return
          const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()
          const wanted = Math.min(Number(selected.slice(8, 10)) || 1, lastDay)
          const candidate = `${nextKey}-${pad2(wanted)}`
          setSelected(candidate > todayKey ? todayKey : candidate)
        }

        const goToday = () => {
          const now = new Date()
          setCursor(startOfMonth(now))
          setSelected(toKey(now))
        }

        const refresh = () => setNonce((value) => value + 1)

        const gridRef = useRef(null)
        const cellRows = useMemo(() => {
          const rows = []
          for (let index = 0; index < cells.length; index += 7) rows.push(cells.slice(index, index + 7))
          return rows
        }, [cells])

        /** Arrow keys move the selected day; one tab stop keeps the calendar compact. */
        const moveSelection = (nextKey) => {
          if (nextKey > todayKey) return
          if (nextKey.slice(0, 7) !== monthKey) setCursor(startOfMonth(new Date(`${nextKey}T00:00:00`)))
          setSelected(nextKey)
          requestAnimationFrame(() => {
            const button = gridRef.current?.querySelector?.(`[data-day="${nextKey}"]`)
            button?.focus?.()
          })
        }

        const onGridKeyDown = (event) => {
          const from = new Date(`${selected}T00:00:00`)
          let next = null
          if (event.key === 'ArrowLeft') next = addDays(from, -1)
          else if (event.key === 'ArrowRight') next = addDays(from, 1)
          else if (event.key === 'ArrowUp') next = addDays(from, -7)
          else if (event.key === 'ArrowDown') next = addDays(from, 7)
          else if (event.key === 'Home') next = new Date(from.getFullYear(), from.getMonth(), 1)
          else if (event.key === 'End') next = new Date(from.getFullYear(), from.getMonth() + 1, 0)
          else if (event.key === 'PageUp') {
            event.preventDefault()
            goMonth(-1)
            return
          } else if (event.key === 'PageDown') {
            event.preventDefault()
            goMonth(1)
            return
          }
          if (!next) return
          event.preventDefault()
          moveSelection(toKey(next))
        }

        const totals = day?.totals
        const sessions = day?.sessions ?? []
        const clockWindow = totals && Number.isFinite(totals.first) && Number.isFinite(totals.last)
          ? `${clockText(totals.first)}–${clockText(totals.last)}`
          : t('common.empty')
        const tokenTotal = totals ? totals.inputTokens + totals.outputTokens : 0

        const cancelToday = selected === todayKey && monthKey === currentMonthKey
        const monthNav = h('div', { className: 'wl-cal-nav' },
          h('span', { className: 'wl-month' }, format(localeId, { year: 'numeric', month: 'long' }, cursor)),
          h('span', { style: { flex: 1 } }),
          h('button', {
            className: 'wl-btn wl-btn-ico',
            type: 'button',
            onClick: () => goMonth(-1),
            title: t('cal.prev'),
            'aria-label': t('cal.prev'),
          }, '‹'),
          h('button', {
            className: 'wl-btn wl-btn-ico',
            type: 'button',
            onClick: () => goMonth(1),
            disabled: monthKey >= currentMonthKey,
            title: t('cal.next'),
            'aria-label': t('cal.next'),
          }, '›'),
          h('button', {
            className: 'wl-btn',
            type: 'button',
            onClick: goToday,
            disabled: cancelToday,
          }, t('cal.today')))

        const calendar = h('section', { className: 'wl-card wl-cal', 'aria-label': t('panel.title') },
          monthNav,
          h('div', { className: 'wl-week' }, WEEKDAY_KEYS.map((key) => h('div', { className: 'wl-wd', key }, t(key)))),
          h('div', {
            className: 'wl-cal-grid',
            role: 'grid',
            'aria-label': t('cal.grid'),
            ref: gridRef,
            onKeyDown: onGridKeyDown,
          },
            cellRows.map((row, rowIndex) => h('div', { className: 'wl-row', role: 'row', key: `row-${rowIndex}` },
              row.map((cell) => {
                const bucket = days[cell.key]
                const score = dayScore(bucket)
                const heat = maxScore > 0 && score > 0 ? Math.max(10, Math.round((score / maxScore) * 88)) : 0
                const isFuture = cell.key > todayKey
                const classes = ['wl-cell']
                if (!cell.inMonth) classes.push('wl-cell-out')
                if (cell.key === todayKey) classes.push('wl-cell-today')
                if (cell.key === selected) classes.push('wl-cell-sel')
                if (isFuture) classes.push('wl-cell-future')
                const summary = bucket && bucket.sessions > 0
                  ? t('cal.summary').replace('{sessions}', String(bucket.sessions)).replace('{turns}', String(bucket.turns))
                  : t('cal.none')
                const label = `${format(localeId, { month: 'long', day: 'numeric' }, new Date(`${cell.key}T00:00:00`))} · ${summary}`
                return h('button', {
                  key: cell.key,
                  type: 'button',
                  className: classes.join(' '),
                  style: { '--wl-heat': `${heat}%` },
                  disabled: isFuture,
                  role: 'gridcell',
                  tabIndex: cell.key === selected ? 0 : -1,
                  'aria-selected': cell.key === selected,
                  'aria-label': label,
                  'data-day': cell.key,
                  title: label,
                  onClick: () => {
                    setSelected(cell.key)
                    if (!cell.inMonth) setCursor(startOfMonth(new Date(`${cell.key}T00:00:00`)))
                  },
                },
                  h('span', { className: 'wl-num' }, cell.dayNumber),
                  bucket && bucket.sessions > 0
                    ? h('span', { className: 'wl-meta', 'aria-hidden': 'true' }, bucket.sessions)
                    : null,
                  bucket && bucket.errors > 0
                    ? h('span', { className: 'wl-dot', 'aria-hidden': 'true' })
                    : null)
              })))),
          h('div', { className: 'wl-legend' },
            h('span', { className: 'wl-legend-swatch wl-legend-swatch-empty' }),
            h('span', null, t('cal.none')),
            h('span', { style: { width: 6 } }),
            h('span', { className: 'wl-legend-swatch wl-legend-swatch-fill' }),
            h('span', null, t('cal.worked')),
            h('span', { style: { flex: 1 } }),
            h('span', null, month ? format(localeId, { year: 'numeric', month: 'long' }, cursor) : t('day.loading'))),
          monthError
            ? h('div', { className: 'wl-err' },
              `${t('common.error')}: ${monthError}`,
              h('button', { className: 'wl-btn', type: 'button', onClick: refresh }, t('common.retry')))
            : null)

        const stats = totals
          ? h('div', { className: 'wl-stats' },
            h(StatCell, { label: t('stat.sessions'), value: totals.sessions }),
            h(StatCell, { label: t('stat.turns'), value: totals.turns }),
            h(StatCell, { label: t('stat.prompts'), value: totals.prompts }),
            h(StatCell, { label: t('stat.tools'), value: totals.toolCalls }),
            h(StatCell, { label: t('stat.window'), value: clockWindow, wide: true }),
            h(StatCell, { label: t('stat.tokens'), value: tokenTotal > 0 ? tokenTotal.toLocaleString(localeId) : t('common.empty'), wide: true }),
            totals.errors > 0 ? h(StatCell, { label: t('stat.errors'), value: totals.errors }) : null)
          : null

        const toolTally = totals && totals.tools && totals.tools.length
          ? h('div', null,
            h('h4', { className: 'wl-list-title' }, t('section.tools')),
            h('div', { className: 'wl-tools' },
              totals.tools.slice(0, 8).map((tool) => h(Chip, { key: tool.name },
                h('b', null, tool.name),
                h('span', null, String(tool.count))))))
          : null

        const sessionList = sessions.length
          ? h('div', null,
            h('h4', { className: 'wl-list-title' }, t('section.sessions')),
            h('div', { className: 'wl-list' },
              sessions.map((session) => {
                const workspace = basename(session.cwd)
                const span = `${clockText(session.first)}–${clockText(session.last)}`
                const card = {
                  key: session.id,
                  className: canOpenSession ? 'wl-session' : 'wl-session wl-session-static',
                }
                if (canOpenSession) {
                  card.type = 'button'
                  card.title = `${t('session.open')}: ${session.title || t('session.untitled')}`
                  card.onClick = () => openSession(session.id)
                }
                return h(canOpenSession ? 'button' : 'div', card,
                  h('div', { className: 'wl-session-top' },
                    h('span', { className: 'wl-session-title' }, session.title || t('session.untitled')),
                    h('span', { className: 'wl-session-time' }, span)),
                  h('div', { className: 'wl-chips' },
                    session.turns > 0 ? h(Chip, { key: 'turns' }, `${t('stat.turns')} `, h('b', null, String(session.turns))) : null,
                    session.toolCalls > 0 ? h(Chip, { key: 'tools' }, `${t('stat.tools')} `, h('b', null, String(session.toolCalls))) : null,
                    session.prompts > 0 ? h(Chip, { key: 'prompts' }, `${t('stat.prompts')} `, h('b', null, String(session.prompts))) : null,
                    session.errors > 0 ? h(Chip, { key: 'errors', bad: true }, `${t('stat.errors')} `, h('b', null, String(session.errors))) : null,
                    session.live ? h(Chip, { key: 'live' }, t('session.live')) : null,
                    session.isSubagent ? h(Chip, { key: 'sub' }, t('session.subagent')) : null,
                    workspace ? h(Chip, { key: 'ws' }, workspace) : null),
                  session.tools.length
                    ? h('div', { className: 'wl-chips' },
                      session.tools.slice(0, 5).map((tool) => h(Chip, { key: tool.name },
                        h('b', null, tool.name),
                        h('span', null, String(tool.count)))))
                    : null,
                  session.samples.length
                    ? h('div', { className: 'wl-prompt' }, session.samples[0].text)
                    : null)
              })),
            day && day.truncated
              ? h('div', { className: 'wl-note' }, t('day.truncated').replace('{count}', String(day.scanned)))
              : null)
          : null

        const overviewBody = dayLoading && !day
          ? h('div', null, h('div', { className: 'wl-skel' }), h('div', { className: 'wl-skel' }), h('div', { className: 'wl-skel' }))
          : dayError
            ? h('div', { className: 'wl-err' },
              `${t('common.error')}: ${dayError}`,
              h('button', { className: 'wl-btn', type: 'button', onClick: refresh }, t('common.retry')))
            : sessions.length === 0
              ? h('div', { className: 'wl-empty' }, t('day.empty'))
              : h('div', null, stats, toolTally, sessionList)

        const overview = h('section', { className: 'wl-card wl-day' },
          h('div', { className: 'wl-dayhead' },
            h('h3', { className: 'wl-day-title' },
              format(localeId, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }, new Date(`${selected}T00:00:00`))),
            selected === todayKey ? h('span', { className: 'wl-badge' }, t('cal.today')) : null,
            dayLoading && day ? h('span', { className: 'wl-sub' }, t('day.loading')) : null,
            h('button', {
              className: 'wl-btn wl-btn-ico',
              type: 'button',
              onClick: refresh,
              title: t('common.refresh'),
              'aria-label': t('common.refresh'),
            }, '⟳')),
          overviewBody)

        return h('div', { className: 'wl-root' },
          h('div', { className: 'wl-head' },
            h('h2', { className: 'wl-title' }, t('panel.title'))),
          h('div', { className: 'wl-layout' }, calendar, overview))
      }

      return WorklogPanel
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => {
          const tag = document.createElement('style')
          tag.dataset.plugin = 'dsh-worklog-calendar'
          tag.textContent = CSS
          document.head.appendChild(tag)
          return () => {
            tag.remove()
          }
        }, 'dsh-worklog-calendar: panel styles')

        // The locale service is read for the active language only. bind() resolves to
        // the raw key when a namespace is not in its merge table, so depending on it
        // left the whole panel in English on a Chinese UI. The dictionaries live here.
        let localeService
        try {
          localeService = ctx.get ? ctx.get('locale') : undefined
        } catch {
          localeService = undefined
        }

        const activeLocaleId = () => {
          try {
            const snapshot = localeService?.getSnapshot?.()
            if (snapshot && typeof snapshot.active === 'string') return snapshot.active
          } catch {
            /* fall through to the default */
          }
          return ''
        }
        const translate = (key, activeLocale = activeLocaleId()) =>
          tableFor(activeLocale)[key] ?? DICT['zh-CN'][key] ?? key

        try {
          const locale = localeService
          if (locale && typeof locale.register === 'function') {
            ctx.effect(() => {
              let offZh = () => {}
              let offEn = () => {}
              try {
                offZh = locale.register(NS, 'zh-CN', DICT['zh-CN'])
                offEn = locale.register(NS, 'en', DICT.en)
              } catch {
                /* a namespace already owned elsewhere is not worth breaking the panel over */
              }
              return () => {
                offZh()
                offEn()
              }
            }, 'dsh-worklog-calendar: locale dictionaries')
          }
        } catch {
          /* registration is optional; the panel keeps its own dictionaries */
        }

        let uiWorkspace
        try {
          uiWorkspace = ctx.get ? ctx.get('uiWorkspace') : undefined
        } catch {
          uiWorkspace = undefined
        }
        const canOpenSession = Boolean(uiWorkspace && typeof uiWorkspace.openSession === 'function')

        const openSession = (sessionId) => {
          if (!canOpenSession) return
          try {
            uiWorkspace.openSession(sessionId)
          } catch {
            /* opening is best effort; the panel stays usable */
          }
        }

        const Panel = createPanel({ translate, localeService, openSession, canOpenSession })

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 25,
          label: () => translate('panel.title'),
        }, WorklogIcon))

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
        }, Panel))
      },
    }
  },
})

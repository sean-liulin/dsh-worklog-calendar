/**
 * Host half of dsh-worklog-calendar.
 *
 * Folds the session corpus into per-day work digests: which sessions ran on a
 * day, how many turns / prompts / tool calls they made, which tools they used,
 * and the first prompts of the day. Read-only: it never writes to a session.
 *
 * The two JSON feeds below back the Client calendar panel:
 *   GET /api/dsh-worklog-calendar/day?date=YYYY-MM-DD
 *   GET /api/dsh-worklog-calendar/month?month=YYYY-MM
 */

const MAX_SESSIONS = 240
/** A live session grows, so its fold expires quickly; an idle log barely changes. */
const LIVE_TTL_MS = 15_000
const IDLE_TTL_MS = 300_000
const TODAY_TTL_MS = 20_000
const HISTORY_TTL_MS = 600_000
const MAX_PROMPTS_PER_DAY = 6
const PROMPT_CHARS = 180
const MAX_TOOLS = 10

export const name = 'dsh-worklog-calendar'
export const inject = ['sessionQuery']

const pad2 = (value) => (value < 10 ? `0${value}` : String(value))

/** Local-calendar day key, e.g. `2026-11-17`. */
function dayKeyOf(time) {
  const date = new Date(time)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/
const MONTH_KEY = /^\d{4}-\d{2}$/

function isMissing(value) {
  return value === null || value === undefined || value === ''
}

/** Flatten one message's text blocks; tolerant of shapes we do not own. */
function textOfMessage(message) {
  const content = message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block && block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n')
}

function snippet(text, limit = PROMPT_CHARS) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat
}

function createDay(time) {
  return {
    turns: 0,
    prompts: 0,
    replies: 0,
    toolCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    errors: 0,
    first: time,
    last: time,
    tools: new Map(),
    samples: [],
  }
}

/** Fold one session log snapshot into per-day totals plus its latest title. */
function foldSnapshot(snapshot) {
  const days = new Map()
  let title
  let lastTime = 0

  const dayFor = (time) => {
    const key = dayKeyOf(time)
    let day = days.get(key)
    if (!day) {
      day = createDay(time)
      days.set(key, day)
    }
    if (time < day.first) day.first = time
    if (time > day.last) day.last = time
    return day
  }

  for (const event of snapshot.events ?? []) {
    if (!event || typeof event.type !== 'string') continue

    if (event.type === 'session/title') {
      const next = event.data?.title
      if (typeof next === 'string' && next.trim()) title = next.trim()
      continue
    }

    const time = event.time
    if (typeof time !== 'number' || time <= 0) continue

    switch (event.type) {
      case 'turn/start':
        dayFor(time).turns += 1
        break
      case 'user/message': {
        // Injected runtime context, skill catalogs and plugin recalls also arrive
        // as user messages; only a person's own input counts as a prompt.
        const source = event.data?.source?.kind
        if (source !== undefined && source !== 'user') break
        const day = dayFor(time)
        day.prompts += 1
        const text = snippet(textOfMessage(event.data))
        if (text && day.samples.length < MAX_PROMPTS_PER_DAY) day.samples.push({ time, text })
        break
      }
      case 'assistant/message': {
        const day = dayFor(time)
        day.replies += 1
        const usage = event.data?.usage
        if (usage) {
          day.inputTokens += Number(usage.inputTokens) || 0
          day.outputTokens += Number(usage.outputTokens) || 0
        }
        break
      }
      case 'tool/call': {
        const day = dayFor(time)
        day.toolCalls += 1
        const toolName = typeof event.data?.name === 'string' && event.data.name ? event.data.name : 'unknown'
        day.tools.set(toolName, (day.tools.get(toolName) ?? 0) + 1)
        break
      }
      case 'turn/end': {
        const day = dayFor(time)
        const kind = event.data?.reason?.kind
        if (kind === 'error' || kind === 'aborted') day.errors += 1
        break
      }
      default:
        break
    }

    if (time > lastTime) lastTime = time
  }

  return { days, title, lastTime }
}

function topTools(tools) {
  return [...tools.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1))
    .slice(0, MAX_TOOLS)
}

/** Bounded-concurrency map so a warm refresh does not read every log at once. */
async function mapPool(items, limit, run) {
  const results = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await run(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

function createStore(ctx) {
  /** sessionId -> folded entry; the value is a derived cache, never a source of truth. */
  const sessions = new Map()
  const responses = new Map()
  const pending = new Map()

  const isFresh = (entry, live) => {
    if (!entry) return false
    const age = Date.now() - entry.builtAt
    return age < (live ? LIVE_TTL_MS : IDLE_TTL_MS)
  }

  async function load(record) {
    const id = record.header.id
    const existing = sessions.get(id)
    if (isFresh(existing, record.live)) return existing
    try {
      const snapshot = await ctx.sessionQuery.readSession(id)
      const folded = foldSnapshot(snapshot)
      const entry = {
        id,
        builtAt: Date.now(),
        live: Boolean(record.live),
        createdAt: snapshot.session?.createdAt ?? record.header.createdAt ?? 0,
        cwd: snapshot.session?.cwd ?? record.header.cwd ?? '',
        parentId: snapshot.session?.parentSession ?? record.header.parentSession ?? null,
        isSubagent: (snapshot.session?.origin ?? record.header.origin) === 'subagent',
        days: folded.days,
        title: folded.title,
        lastTime: folded.lastTime,
      }
      sessions.set(id, entry)
      return entry
    } catch {
      return existing ?? null
    }
  }

  /** Fold every session that could hold an event at or before `until`. */
  async function corpus(until) {
    const records = await ctx.sessionQuery.listSessions()
    const eligible = []
    for (const record of records) {
      const createdAt = record.header?.createdAt ?? 0
      if (createdAt > until) continue
      eligible.push(record)
      if (eligible.length >= MAX_SESSIONS) break
    }
    const entries = await mapPool(eligible, 4, load)
    return {
      entries: entries.filter(Boolean),
      truncated: records.length > eligible.length,
      scanned: eligible.length,
    }
  }

  function remember(key, ttl, body) {
    responses.set(key, { at: Date.now(), body })
    if (responses.size > 64) {
      const oldest = [...responses.entries()].sort((a, b) => a[1].at - b[1].at)[0]
      if (oldest) responses.delete(oldest[0])
    }
    return body
  }

  return {
    async day(dateKey) {
      const key = `day:${dateKey}`
      const cached = responses.get(key)
      const ttl = dateKey === dayKeyOf(Date.now()) ? TODAY_TTL_MS : HISTORY_TTL_MS
      if (cached && Date.now() - cached.at < ttl) return cached.body
      if (pending.has(key)) return pending.get(key)
      const run = (async () => {
        const startOfDay = new Date(`${dateKey}T00:00:00`).getTime()
        const endOfDay = startOfDay + 86_400_000
        const { entries, truncated, scanned } = await corpus(endOfDay)
        const totals = {
          sessions: 0,
          turns: 0,
          prompts: 0,
          replies: 0,
          toolCalls: 0,
          inputTokens: 0,
          outputTokens: 0,
          errors: 0,
          first: null,
          last: null,
          tools: new Map(),
        }
        const list = []
        for (const entry of entries) {
          const day = entry.days.get(dateKey)
          if (!day) continue
          totals.sessions += 1
          totals.turns += day.turns
          totals.prompts += day.prompts
          totals.replies += day.replies
          totals.toolCalls += day.toolCalls
          totals.inputTokens += day.inputTokens
          totals.outputTokens += day.outputTokens
          totals.errors += day.errors
          if (totals.first === null || day.first < totals.first) totals.first = day.first
          if (totals.last === null || day.last > totals.last) totals.last = day.last
          for (const [toolName, count] of day.tools) {
            totals.tools.set(toolName, (totals.tools.get(toolName) ?? 0) + count)
          }
          list.push({
            id: entry.id,
            title: entry.title ?? '',
            cwd: entry.cwd,
            parentId: entry.parentId,
            isSubagent: entry.isSubagent,
            live: entry.live,
            turns: day.turns,
            prompts: day.prompts,
            replies: day.replies,
            toolCalls: day.toolCalls,
            inputTokens: day.inputTokens,
            outputTokens: day.outputTokens,
            errors: day.errors,
            first: day.first,
            last: day.last,
            tools: topTools(day.tools),
            samples: day.samples,
          })
        }
        list.sort((a, b) => a.first - b.first || a.id.localeCompare(b.id))
        return remember(key, ttl, {
          date: dateKey,
          generatedAt: Date.now(),
          truncated,
          scanned,
          totals: { ...totals, tools: topTools(totals.tools) },
          sessions: list,
        })
      })().finally(() => pending.delete(key))
      pending.set(key, run)
      return run
    },

    async month(monthKey) {
      const key = `month:${monthKey}`
      const cached = responses.get(key)
      const ttl = monthKey === dayKeyOf(Date.now()).slice(0, 7) ? TODAY_TTL_MS : HISTORY_TTL_MS
      if (cached && Date.now() - cached.at < ttl) return cached.body
      if (pending.has(key)) return pending.get(key)
      const run = (async () => {
        const [year, month] = monthKey.split('-').map(Number)
        const until = new Date(year, month, 1).getTime()
        const { entries, truncated, scanned } = await corpus(until)
        const days = {}
        for (const entry of entries) {
          for (const [dateKey, day] of entry.days) {
            if (!dateKey.startsWith(`${monthKey}-`)) continue
            let bucket = days[dateKey]
            if (!bucket) {
              bucket = { sessions: 0, turns: 0, prompts: 0, replies: 0, toolCalls: 0, errors: 0, first: day.first, last: day.last }
              days[dateKey] = bucket
            }
            bucket.sessions += 1
            bucket.turns += day.turns
            bucket.prompts += day.prompts
            bucket.replies += day.replies
            bucket.toolCalls += day.toolCalls
            bucket.errors += day.errors
            if (day.first < bucket.first) bucket.first = day.first
            if (day.last > bucket.last) bucket.last = day.last
          }
        }
        return remember(key, ttl, { month: monthKey, generatedAt: Date.now(), truncated, scanned, days })
      })().finally(() => pending.delete(key))
      pending.set(key, run)
      return run
    },
  }
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

function textResponse(text, status) {
  return new Response(JSON.stringify({ error: text }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function apply(ctx) {
  const store = createStore(ctx)

  ctx.inject(['connection'], (scope) => {
    scope.effect(() => scope.connection.fetch.register({
      path: '/api/dsh-worklog-calendar/day',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          const url = new URL(request?.url ?? '/', 'http://localhost')
          const raw = url.searchParams.get('date')
          const date = isMissing(raw) ? dayKeyOf(Date.now()) : String(raw)
          if (!DAY_KEY.test(date)) return textResponse('date must be YYYY-MM-DD', 400)
          return jsonResponse(await store.day(date))
        } catch (cause) {
          return textResponse(cause instanceof Error ? cause.message : String(cause), 500)
        }
      },
    }), 'dsh-worklog-calendar: day feed')

    scope.effect(() => scope.connection.fetch.register({
      path: '/api/dsh-worklog-calendar/month',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          const url = new URL(request?.url ?? '/', 'http://localhost')
          const raw = url.searchParams.get('month')
          const month = isMissing(raw) ? dayKeyOf(Date.now()).slice(0, 7) : String(raw)
          if (!MONTH_KEY.test(month)) return textResponse('month must be YYYY-MM', 400)
          return jsonResponse(await store.month(month))
        } catch (cause) {
          return textResponse(cause instanceof Error ? cause.message : String(cause), 500)
        }
      },
    }), 'dsh-worklog-calendar: month feed')
  })
}

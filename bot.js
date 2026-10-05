const mineflayer = require('mineflayer')

// ====== CONFIG (edit or use environment variables) ======
const config = {
  host: process.env.MC_HOST || 'szunyogszex.aternos.me',
  port: parseInt(process.env.MC_PORT || '56265'),
  username: process.env.MC_USER || 'AFK_Bot',
  // 'offline' for cracked Aternos servers, 'microsoft' for online-mode servers
  auth: process.env.MC_AUTH || 'offline',
  // false = auto-detect the server's version. Or set e.g. '26.3'
  version: process.env.MC_VERSION || false,
  reconnectDelay: 15000, // ms; grows on repeated failures
  // Safe mode: no physics, so the bot never sends movement packets.
  // This avoids "Invalid move player packet" kicks on versions mineflayer
  // doesn't fully support yet. Set MC_MOVE=true to re-enable walking/jumping.
  move: process.env.MC_MOVE === 'true'
}
// ========================================================

let attempts = 0
let currentBot = null
let duplicateLogin = false
let shuttingDown = false
let actionTimer = null


// ---------------------------------------------------------------------------
// 26.3 compatibility patch (until Mineflayer officially supports 26.3)
// 26.3's teleport_confirm packet carries the resolved position/rotation.
// Mineflayer only sends teleportId, so the other fields go out as NaN and the
// server kicks with "Invalid move player packet received". We fill them in,
// and send tick_end after movement packets (26.3 requires it).
// Disable with MC_PATCH=false once Mineflayer supports 26.3 natively.
// ---------------------------------------------------------------------------
function patch263 (bot) {
  const client = bot._client
  let lastPos = null

  // prepend so we store the position before Mineflayer's own handler replies
  client.prependListener('position', (p) => { lastPos = p })

  const origWrite = client.write.bind(client)
  client.write = (name, params) => {
    if (name === 'teleport_confirm' && lastPos) {
      params = Object.assign({}, params, {
        x: lastPos.x,
        y: lastPos.y,
        z: lastPos.z,
        yRot: lastPos.yaw,
        xRot: lastPos.pitch
      })
    }
    const result = origWrite(name, params)
    if (name === 'position' || name === 'position_look' || name === 'look' || name === 'flying') {
      try { origWrite('tick_end', {}) } catch (e) { /* protocol has no tick_end */ }
    }
    return result
  }
}

function startBot () {
  console.log(`[bot] connecting to ${config.host}:${config.port} ...`)

  const bot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: config.username,
    auth: config.auth,
    version: config.version,
    hideErrors: false,
    checkTimeoutInterval: 60000
  })

  currentBot = bot
  duplicateLogin = false
  if (process.env.MC_PATCH !== 'false') patch263(bot)
  if (!config.move) bot.physicsEnabled = false

  bot.once('spawn', () => {
    attempts = 0
    console.log(`[bot] spawned as ${bot.username} (version ${bot.version})`)
    startAntiAfk(bot)
  })

  bot.on('death', () => console.log('[bot] died, respawning'))
  bot.on('health', () => { if (bot.health <= 0) bot.respawn?.() })

  bot.on('kicked', (reason) => {
    const text = JSON.stringify(reason)
    console.log('[bot] kicked:', text)
    if (/another location|already logged|duplicate/i.test(text)) duplicateLogin = true
  })
  bot.on('error', (err) => console.log('[bot] error:', err.message))

  bot.once('end', (reason) => {
    console.log('[bot] disconnected:', reason)
    stopAntiAfk()
    if (shuttingDown) return
    attempts++
    // Back off up to ~2 minutes if the server is offline / starting
    let delay = Math.min(config.reconnectDelay * Math.min(attempts, 8), 120000)
    // Another session (old deploy / other copy) holds this name. Wait longer,
    // with random jitter, so we don't just kick each other in a loop.
    if (duplicateLogin) {
      delay = 60000 + Math.random() * 60000
      console.log('[bot] duplicate login detected - another copy of this bot is running')
    }
    console.log(`[bot] reconnecting in ${Math.round(delay / 1000)}s`)
    setTimeout(startBot, delay)
  })
}

function startAntiAfk (bot) {
  const controls = ['forward', 'back', 'left', 'right']

  actionTimer = setInterval(() => {
    if (!bot.entity) return

    if (!config.move) {
      // Packet-light activity only
      bot.swingArm('right')
      return
    }

    // Random look direction
    const yaw = Math.random() * Math.PI * 2
    const pitch = (Math.random() - 0.5) * 0.8
    bot.look(yaw, pitch, false)

    // Random short move
    const dir = controls[Math.floor(Math.random() * controls.length)]
    bot.setControlState(dir, true)
    setTimeout(() => bot.setControlState(dir, false), 400 + Math.random() * 600)

    // Jump sometimes
    if (Math.random() < 0.5) {
      bot.setControlState('jump', true)
      setTimeout(() => bot.setControlState('jump', false), 250)
    }

    // Swing arm sometimes
    if (Math.random() < 0.3) bot.swingArm('right')
  }, 20000 + Math.random() * 10000)
}

function stopAntiAfk () {
  if (actionTimer) clearInterval(actionTimer)
  actionTimer = null
}

// On Railway redeploys, the old container gets SIGTERM. Leave the server
// cleanly so the new container isn't kicked by a lingering old session.
function shutdown () {
  shuttingDown = true
  stopAntiAfk()
  try { currentBot && currentBot.quit() } catch (e) {}
  setTimeout(() => process.exit(0), 1500)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

process.on('uncaughtException', (e) => console.log('[bot] uncaught:', e.message))
startBot()

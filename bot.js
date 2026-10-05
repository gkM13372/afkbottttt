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
let actionTimer = null

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

  if (!config.move) bot.physicsEnabled = false

  bot.once('spawn', () => {
    attempts = 0
    console.log(`[bot] spawned as ${bot.username} (version ${bot.version})`)
    startAntiAfk(bot)
  })

  bot.on('death', () => console.log('[bot] died, respawning'))
  bot.on('health', () => { if (bot.health <= 0) bot.respawn?.() })

  bot.on('kicked', (reason) => console.log('[bot] kicked:', JSON.stringify(reason)))
  bot.on('error', (err) => console.log('[bot] error:', err.message))

  bot.once('end', (reason) => {
    console.log('[bot] disconnected:', reason)
    stopAntiAfk()
    attempts++
    // Back off up to ~2 minutes if the server is offline / starting
    const delay = Math.min(config.reconnectDelay * Math.min(attempts, 8), 120000)
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

process.on('uncaughtException', (e) => console.log('[bot] uncaught:', e.message))
startBot()

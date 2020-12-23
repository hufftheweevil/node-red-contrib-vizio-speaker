let Speaker = require('vizio-speaker')

module.exports = function (RED) {
  // SPEAKERS directory is global among all nodes
  const speakers = {}

  function getSpeaker(ip) {
    if (speakers[ip]) return speakers[ip]

    return new Promise(resolve => {
      speakers[ip] = new Speaker(ip)
      speakers[ip].on('ready', () => resolve(speakers[ip]))
    })
  }

  function VizioSpeaker(config) {
    RED.nodes.createNode(this, config)
    let node = this

    let debug = msg => config.debug && node.warn(msg)

    this.on('input', async msg => {
      let ip = config.useSpeaker && config.speaker
      if (!ip || (config.allowSpeakerOverride && msg.hasOwnProperty('topic'))) ip = msg.topic
      if (!ip) return node.warn('No speaker specified')

      let cmd = config.useCommand && config.command
      if (!cmd || (config.allowCommandOverride && msg.hasOwnProperty('payload'))) cmd = msg.payload
      if (!cmd) return node.warn('No command specified')

      let speaker = await getSpeaker(ip)

      if (cmd === true) cmd = 'on'
      if (cmd === false) cmd = 'off'

      debug(`Sending command '${cmd}' to ${ip}`)

      let payload // For outbound msg
      switch (cmd) {
        case 'on':
        case 'off':
        case 'toggle':
          speaker.power[cmd]()
          break

        case 'up':
        case 'down':
        case 'unmute':
        case 'mute':
        case 'toggleMute':
          speaker.volume[cmd]()
          break

        case 'play':
        case 'pause':
          speaker.media[cmd]()
          break

        case 'getPower':
        case 'getInput':
        case 'getVolume':
          payload = await speaker[cmd.slice(4).toLowerCase()].get()
          node.send({ topic: ip, payload })
          break
        case 'getMute':
          payload = await speaker.volume.getMute()
          node.send({ topic: ip, payload })
          break
        case 'listInputs':
          payload = await speaker.input.list()
          node.send({ topic: ip, payload })
          break

        case 'startEvents':
          startEvents(ip)
          break

        case 'stopEvents':
          stopEvents(ip)
          break

        default:
          // Set volume level
          if (!isNaN(+cmd)) {
            speaker.volume.set(+cmd)
            break
          }

          // Set input
          if (Object.values(speaker.settings.input.cache).includes(cmd)) {
            speaker.input.set(cmd)
            break
          }

          node.warn(`Unknown command ${cmd}`)
      }
    })

    // CALLBACKS directory is local to this node
    let callbacks = {}

    let makeCallback = topic => payload => node.send({ topic, payload })

    let startEvents = async ip => {
      debug(`Starting events for ${ip}`)
      // Get speaker
      let speaker = await getSpeaker(ip)
      // Get or make callback
      if (!callbacks[ip]) callbacks[ip] = makeCallback(ip)
      let callback = callbacks[ip]
      // Clear any old callback
      speaker.off('change', callback)
      // Set callback
      speaker.on('change', callback)
      // Begin or reset polling
      speaker.poll(10000)
      updateStatus()
    }

    let stopEvents = ip => {
      debug(`Stopping events for ${ip}`)
      let speaker = speakers[ip]
      if (!speaker) return
      // Stop listener for this node
      if (callbacks[ip]) speaker.off('change', callbacks[ip])
      updateStatus()
    }

    if (config.startEventsImmed && config.speaker) startEvents(config.speaker)

    this.on('close', () => Object.keys(callbacks).forEach(stopEvents))

    let updateStatus = () => {
      if (!config.showStatus) return
      let ips = Object.keys(callbacks)
      this.status({
        text: ips.length ? `Watching ${ips.join(', ')}` : ''
      })
    }
  }
  RED.nodes.registerType('vizio-speaker', VizioSpeaker)

  RED.httpAdmin.get('/vizio', async function (req, res) {
    let speaker = await getSpeaker(req.query.ip)
    switch (req.query.type) {
      case 'test':
        let power = await speaker.power.get()
        res.send(power)
        break
      case 'pair':
        speaker.pair()
        break
    }
  })
}

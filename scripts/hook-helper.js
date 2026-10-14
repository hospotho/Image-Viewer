;(async function () {
  'use strict'

  const safeSendMessage = function (...args) {
    if (chrome.runtime?.id) {
      return chrome.runtime.sendMessage(...args)
    }
  }

  if (document.contentType !== 'text/html' || !crypto.subtle || !chrome.runtime?.id) return

  // prepare crypto bridge
  const channel = 'iv-hook-' + crypto.randomUUID()
  const keyBytes = crypto.getRandomValues(new Uint8Array(32))
  const keyB64 = btoa(String.fromCharCode(...keyBytes))
  const initEvent = new CustomEvent('iv-hook-init', {detail: JSON.stringify([channel, keyB64]), cancelable: true})
  // exchange key synchronously before page scripts can observe the event
  const unhandled = window.dispatchEvent(initEvent)
  if (unhandled) {
    keyBytes.fill(0)
    return
  }
  // init encryption bridge
  const keyPromise = crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt', 'decrypt']).catch(() => {})
  keyBytes.fill(0)
  const bridgeKey = await keyPromise
  if (!bridgeKey) return

  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  let lastPing = 0

  function getCryptoParams(iv, id, direction) {
    return {name: 'AES-GCM', iv: iv, additionalData: encoder.encode(`${channel}:${id}:${direction}`), tagLength: 128}
  }
  async function sendResponse(id, dataUrl) {
    // encrypt dataUrl
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const bytes = encoder.encode(dataUrl)
    const cipher = await crypto.subtle.encrypt(getCryptoParams(iv, id, 'response'), bridgeKey, bytes)
    const payload = new Uint8Array(iv.length + cipher.byteLength)
    payload.set(iv)
    payload.set(new Uint8Array(cipher), iv.length)
    let payloadStr = ''
    for (let i = 0; i < payload.length; i += 32768) {
      payloadStr += String.fromCharCode(...payload.subarray(i, i + 32768))
    }
    // send response
    const payloadB64 = btoa(payloadStr)
    const event = new CustomEvent(`${channel}-response`, {detail: JSON.stringify([id, payloadB64])})
    window.dispatchEvent(event)
  }
  async function unwrapRequest(detail) {
    try {
      // process request
      const [id, payloadB64] = JSON.parse(detail)
      const invalidId = typeof id !== 'number' || id < 1
      const invalidPayload = typeof payloadB64 !== 'string' || payloadB64.length > 65536
      if (invalidId || invalidPayload) return null
      const payloadStr = atob(payloadB64)
      const payload = Uint8Array.from(payloadStr, char => char.charCodeAt(0))
      if (payload.length < 28) return null
      // decrypt src
      const iv = payload.subarray(0, 12)
      const cipher = payload.subarray(12)
      const bytes = await crypto.subtle.decrypt(getCryptoParams(iv, id, 'request'), bridgeKey, cipher)
      const src = decoder.decode(bytes)
      return [id, src]
    } catch (error) {
      return null
    }
  }
  window.addEventListener(`${channel}-request`, async e => {
    // wake up background
    while (true) {
      if (Date.now() - lastPing < 20000) break
      if (await safeSendMessage({msg: 'ping'})) break
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    lastPing = Date.now()
    // handle request
    const detail = e.detail
    if (!detail || typeof detail !== 'string') return
    const result = await unwrapRequest(detail)
    if (!result) return
    const [id, src] = result
    const [dataUrl, mime] = await safeSendMessage({msg: 'request_cors_url', url: src})
    if (mime?.startsWith('image/') || mime?.startsWith('application/octet-stream')) sendResponse(id, dataUrl)
    else sendResponse(id, '')
  })
})()

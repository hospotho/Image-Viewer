;(function () {
  'use strict'

  const safeSendMessage = function (...args) {
    if (chrome.runtime?.id) {
      return chrome.runtime.sendMessage(...args)
    }
  }

  if (document.contentType !== 'text/html' || !crypto.randomUUID || !chrome.runtime?.id) return

  const channel = 'iv-hook-' + crypto.randomUUID()
  const initEvent = new CustomEvent('iv-hook-init', {detail: channel, cancelable: true})
  // exchange channel synchronously before page scripts can observe the event
  const unhandled = window.dispatchEvent(initEvent)
  if (unhandled) return

  let lastPing = 0
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
    const [id, src] = JSON.parse(detail)
    const [dataUrl, mime] = await safeSendMessage({msg: 'request_cors_url', url: src})
    // send response
    const isImage = mime?.startsWith('image/') || mime === 'application/octet-stream'
    const response = JSON.stringify([id, isImage ? dataUrl : ''])
    window.dispatchEvent(new CustomEvent(`${channel}-response`, {detail: response}))
  })
})()

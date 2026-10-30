;(function () {
  'use strict'

  const safeSendMessage = function (...args) {
    if (chrome.runtime?.id) {
      return chrome.runtime.sendMessage(...args)
    }
  }

  if (document.contentType !== 'text/html' || !chrome.runtime?.id) return

  const channel = 'iv-hook-' + Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')
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
    const [dataUrl] = await safeSendMessage({msg: 'request_cors_url', url: src})
    // send response
    const response = `[${id},"${dataUrl}"]`
    window.dispatchEvent(new CustomEvent(`${channel}-response`, {detail: response}))
  })
})()

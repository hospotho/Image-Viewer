;(async function () {
  'use strict'

  const safeSendMessage = function (...args) {
    if (chrome.runtime?.id) {
      return chrome.runtime.sendMessage(...args)
    }
  }

  async function processDomRequest(node) {
    if (node.hasAttribute('iv-processed')) return
    node.setAttribute('iv-processed', '')

    const url = node.getAttribute('iv-url')
    const response = await safeSendMessage({msg: 'request_cors_url', url: url})
    if (!response) return

    const [dataUrl, mime] = response
    if (mime?.startsWith('image/')) {
      node.setAttribute('iv-url', dataUrl)
    }
  }

  async function action() {
    // wake up background
    while (true) {
      if (await safeSendMessage({msg: 'ping'})) break
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    document.querySelectorAll('div[id^="iv-request-"]').forEach(processDomRequest)
  }

  window.addEventListener('load', async () => {
    await action()
    const observer = new MutationObserver(action)
    observer.observe(document.body, {childList: true})
  })
})()

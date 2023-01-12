;(async function () {
  'use strict'

  const image = document.querySelector(`body img[src='${location.href}']`)
  if (image) {
    const options = await chrome.runtime.sendMessage('get_options')
    options.closeButton = false
    options.minWidth = 0
    options.minHeight = 0

    await chrome.runtime.sendMessage('load_script')
    image.style.display = 'none'
    imageViewer([image.src], options)
  } else {
    if (document.visibilityState === 'visible') {
      console.log('Init content script.')
      chrome.runtime.sendMessage('load_worker')
      return
    }
    console.log('Waiting user to view the page.')
    const handleEvent = () => {
      console.log('Init content script.')
      chrome.runtime.sendMessage('load_worker')
      document.removeEventListener('visibilitychange', handleEvent)
      window.removeEventListener('focus', handleEvent)
    }
    document.addEventListener('visibilitychange', handleEvent)
    window.addEventListener('focus', handleEvent)
  }
})()

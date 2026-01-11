;(function () {
  'use strict'

  function captureFrame(url) {
    const {promise, resolve} = Promise.withResolvers()
    const canvas = document.createElement('canvas')
    const video = document.createElement('video')
    video.muted = true
    video.crossOrigin = 'anonymous'
    video.preload = 'auto'

    const init = () => {
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      video.currentTime = 0
    }
    const check = () => {
      const ctx = canvas.getContext('2d')
      ctx.drawImage(video, 0, 0)
      video.pause()
      const dataUrl = canvas.toDataURL('image/jpeg')
      resolve(dataUrl)
    }
    video.addEventListener('loadeddata', init, {once: true})
    video.addEventListener('seeked', check, {once: true})
    video.addEventListener('error', () => resolve(''), {once: true})
    video.src = url

    return promise
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'get_first_frame') {
      captureFrame(msg.url).then(sendResponse)
      return true
    }
  })
})()

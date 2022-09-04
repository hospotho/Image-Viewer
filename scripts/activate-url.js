;(async function () {
  'use strict'

  const image = document.querySelector(`body img[src='${location.href}']`)
  if (!image) return
  
  const {options} = await chrome.runtime.sendMessage('get_options')
  options.closeButton = false
  options.minWidth = 0
  options.minHeight = 0

  await chrome.runtime.sendMessage('load_script')
  image.style.display = 'none'
  imageViewer([image.src], options)
})()
